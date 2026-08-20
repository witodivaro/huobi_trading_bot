import {
  LONG_STOP_LOSS_DEVIATION,
  SHORT_STOP_LOSS_DEVIATION,
  STOP_LOSS_DEVIATION,
} from "./trader.data";
import {
  OrderFeedee,
  OrderListener,
  OrderNotification,
  PriceFeedee,
  PriceListener,
} from "../feedees/types";
import {
  calculateEqualVolume,
  calculatePercentageDifference,
  calculateStopLoss,
} from "../utils/calculator";
import { Long } from "../puppets/Long";
import { Short } from "../puppets/Short";

import { log } from "../utils/logger";
import { ContractCode } from "../types/order";
import {
  AccountOrderPos,
  AccountPositionsOrders,
  getAccountPositionsOrders,
  getHasEnoughBalance,
} from "../utils/initializer";
import { cancelAllStopLossTakeProfit } from "../api/linear-swap-api/v1/swap_tpsl_cancelall";
import { PositionState } from "../puppets/Position";
import { getPrecision, toFixed } from "../utils/number";

export class Trader {
  private long: Long | null = null;
  private short: Short | null = null;
  private _pricePrecision = 0;

  private _priceChangeHandler: PriceListener | null = null;
  private _orderUpdateHandler: OrderListener | null = null;

  constructor(
    private _contractCode: ContractCode,
    private _priceFeedee: PriceFeedee,
    private _orderFeedee: OrderFeedee
  ) {
    this._priceChangeHandler = this.handlePriceChange.bind(this);
    this._orderUpdateHandler = this.handleOrderUpdate.bind(this);
  }

  async init() {
    const accountPositionsOrders = await getAccountPositionsOrders(
      this._contractCode
    );

    const hasEnoughBalance = this.checkHasEnoughBalance(accountPositionsOrders);
    const {
      margin_available,
      short,
      long,
      hasOpenPositionsOrAndOrders,
      contract_size,
    } = accountPositionsOrders;

    const latestPrice = this.getLatestPrice();

    if (this._contractCode === ContractCode.BTC_USDT) {
      this._pricePrecision = 1;
    } else {
      this._pricePrecision = getPrecision(latestPrice);
    }

    if (short) {
      await this.syncShort(short);
    }

    if (long) {
      await this.syncLong(long);
    }

    if (!hasOpenPositionsOrAndOrders && !hasEnoughBalance) {
      throw new Error(
        `${
          this._contractCode
        } trader can't open new positions due to unsufficient balance. Min is ${
          contract_size * latestPrice * 2
        }`
      );
    }

    if (!hasOpenPositionsOrAndOrders && hasEnoughBalance) {
	await this.openPositions(
		latestPrice,
		margin_available,
		contract_size
	);
    }

    this
	._priceFeedee
	.addListener(
		this._priceChangeHandler as PriceListener
	);
    this
	._orderFeedee
	.addListener(
		this._orderUpdateHandler as OrderListener
	);
  }

  checkHasEnoughBalance({
    margin_available,
    contract_size,
  }: AccountPositionsOrders) {
    const latestPrice = this.getLatestPrice();

    return getHasEnoughBalance(
		margin_available,
		latestPrice,
		contract_size
	);
  }

  getLatestPrice() {
    const latestPrice =
		this
			._priceFeedee
			.getLatestPrice();

    if (!latestPrice) {
      throw new Error(
        `${this._contractCode} trader was initialized before first price is fetched`
      );
    }

    return latestPrice;
  }

  	async syncShort(
		order: AccountOrderPos
	) {
    	const initialStopLoss = calculateStopLoss(
      		order.entryPrice,
      		SHORT_STOP_LOSS_DEVIATION,
      		this._pricePrecision
    	);

	this.short =
		Short.fromExisting(
			this._contractCode,
			order
		);

    if (
		order.state === PositionState.OPEN
		&& !this.short.stopLossOrder
	) {
      await this.short.placeStopLoss(initialStopLoss);
    }

    log(`${this._contractCode} trader syncs with existing SHORT position.`);
    log(`Entry price: ${order.entryPrice}`);
    log(`Volume: ${order.volume}`);
    log(`State: ${order.state}`);
    log("");
  }

  async syncLong(order: AccountOrderPos) {
    const initialStopLoss = calculateStopLoss(
      order.entryPrice,
      LONG_STOP_LOSS_DEVIATION,
      this._pricePrecision
    );

    this.long =
	Long
		.fromExisting(
			this._contractCode,
			order
		);

    if (this.long.state === PositionState.OPEN && !this.long.stopLossOrder) {
      await this.long.placeStopLoss(initialStopLoss);
    }

    log(`${this._contractCode} trader syncs with existing LONG position.`);
    log(`Entry price: ${order.entryPrice}`);
    log(`Volume: ${order.volume}`);
    log(`State: ${order.state}`);
    log("");
  }

  	async openShort(
		price: number,
		volume: number
	) {
	const stopLoss = calculateStopLoss(
      		price,
      		SHORT_STOP_LOSS_DEVIATION,
      		this._pricePrecision
    	);
    this.short = new Short(
		this._contractCode,
		price,
		volume,
		stopLoss
	);

    await this.short.open();
  }

  async openLong(
		price: number,
		amount: number
	) {
	const stopLoss = calculateStopLoss(
      		price,
      		LONG_STOP_LOSS_DEVIATION,
      		this._pricePrecision
    	);

	this.long =
		new Long(
			this._contractCode,
			price,
			amount,
			stopLoss
		);

	await this.long.open();
  }

  async openPositions(
    price: number,
    marginAvailable: number,
    contractSize: number
  ) {
    const volume =
	calculateEqualVolume(
		price,
		marginAvailable,
		contractSize
	);

    const openShortPromise
	= this.openShort(price, volume);
    const openLongPromise
	= this.openLong(price, volume);

    log(
      `${this._contractCode} trader opens new positions at ${price} of ${volume} volume`
    );

    await Promise.all([
		openLongPromise,
		openShortPromise
	]);
  }

  async handleAllPositionsAreClosed() {
    const accountPositionsOrders = await getAccountPositionsOrders(
      this._contractCode
    );

    const hasEnoughBalance = this.checkHasEnoughBalance(accountPositionsOrders);
    const { margin_available, hasOpenPositionsOrAndOrders, contract_size } =
      accountPositionsOrders;

    if (hasOpenPositionsOrAndOrders) {
      throw new Error(
        `${this._contractCode} tried to handle all positions closed having a position or orders open`
      );
    }

    if (!hasEnoughBalance) {
      throw new Error(
        `${this._contractCode} trader can't open new positions due to unsufficient balance`
      );
    }

    const latestPrice = this.getLatestPrice();
    await cancelAllStopLossTakeProfit(
		{
			contract_code:
				this._contractCode
		}
	);

    await this.openPositions(
		latestPrice,
		margin_available,
		contract_size
	);
  }

  	async handlePriceChange(
		latestPrice: number
	) {

	await this.updateStopLossesBasedOnPrice(
		latestPrice
	);
  }

  	async handleOrderUpdate(
		order: OrderNotification
	) {
    		log(`${this._contractCode} order is updated`, order);
    	const longCheckPromise = this.long?.checkOrderUpdate(order);

	const shortCheckPromise = this.short?.checkOrderUpdate(order);

    await Promise.all([
		longCheckPromise,
		shortCheckPromise
	]);

    const shortIsClosedOrNotExists = !this.short || this.short.isClosed();
    const longIsClosedOrNotExists = !this.long || this.long.isClosed();

    const positionsAreClosedOrNotExist =
      shortIsClosedOrNotExists && longIsClosedOrNotExists;

    log(`${this._contractCode}:`, this.short);
    log(`${this._contractCode}:`, this.long);
    if (positionsAreClosedOrNotExist) {
      await this.handleAllPositionsAreClosed();
    }
  }

  private async
	updateStopLossesBasedOnPrice(price: number) {
    if (this.long && this.long.isOpen()) {
      const currentPriceDeviation = calculatePercentageDifference(
        this.long.entryPrice,
        price
      );
      const stopLoss = calculateStopLoss(
        price,
        LONG_STOP_LOSS_DEVIATION,
        this._pricePrecision
      );

      if (
        currentPriceDeviation > STOP_LOSS_DEVIATION &&
        stopLoss > this.long.stopLossPrice
      ) {
        const stopLossDeviation = toFixed(
          calculatePercentageDifference(this.long.entryPrice, stopLoss),
          2
        );

        log(`${this._contractCode} updates LONG stop loss`);
        log(`Current Price - ${price}`);
        log(`Deviation - ${toFixed(currentPriceDeviation, 2)}%`);
        log(`Stop Loss Price - ${stopLoss}`);
        log(`Stop Loss Deviation - ${toFixed(stopLossDeviation, 2)}%`);
        log("");

        this.long.updateStopLoss(stopLoss);
      }
    }

    // Short is the only position left
    if (this.short && this.short.isOpen()) {
      const currentPriceDeviation = calculatePercentageDifference(
        this.short.entryPrice,
        price
      );

      const stopLoss = calculateStopLoss(
        price,
        SHORT_STOP_LOSS_DEVIATION,
        this._pricePrecision
      );

      if (
        currentPriceDeviation < -STOP_LOSS_DEVIATION &&
        stopLoss < this.short.stopLossPrice
      ) {
        const stopLossDeviation = toFixed(
          calculatePercentageDifference(this.short.entryPrice, stopLoss),
          2
        );
        log(`${this._contractCode} updates SHORT stop loss`);
        log(`Current Price - ${price}`);
        log(`Deviation - ${toFixed(currentPriceDeviation, 2)}%`);
        log(`Stop Loss Price - ${stopLoss}`);
        log(`Stop Loss Deviation - ${toFixed(stopLossDeviation, 2)}%`);
        log("");

        this.short.updateStopLoss(stopLoss);
      }
    }
  }
}
