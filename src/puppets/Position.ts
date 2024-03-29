import { cancelStopLossTakeProfit } from "../api/linear-swap-api/v1/swap_tpsl_cancel";
import { SLTLOrderDigest } from "../api/linear-swap-api/v1/swap_tpsl_order";
import { OrderNotification } from "../feedees/types";
import { ContractCode, OrderSource, OrderStatus } from "../types/order";
import { calculatePercentageDifference } from "../utils/calculator";
import { debounced } from "../utils/debouncer";
import { log } from "../utils/logger";
import { toFixed } from "../utils/number";
import { UPDATE_DEBOUNCE } from "./Position.data";

export enum PositionState {
  INITIALIZED = "initialized",
  PENDING = "pending",
  OPEN = "open",
  CLOSING = "closing",
  CLOSED = "closed",
}

export abstract class Position {
  orderId: string | null = null;
  stopLossOrder: SLTLOrderDigest | null = null;

  constructor(
    public contractCode: ContractCode,
    public entryPrice: number,
    public volume: number,
    public stopLossPrice: number,
    public state = PositionState.INITIALIZED
  ) {}

  async open() {
    if (!this.isInitialized()) {
      throw new Error("Can't open position if it's state is not 'Initialized'");
    }

    log(
      `${this.contractCode} position order placed at ${this.entryPrice} for ${this.volume}`
    );

    try {
      await this._placeOrder();
    } catch (err) {
      log(`${this.contractCode} error opening orders`, err);
    }
  }

  updateStopLoss = (stopLossPrice: number) => {
    this.stopLossPrice = stopLossPrice;
    this._debouncedUpdateStopLoss(stopLossPrice);
  };

  _debouncedUpdateStopLoss = debounced(this._updateStopLoss.bind(this), UPDATE_DEBOUNCE);

  async _updateStopLoss(stopLossPrice: number) {
    if (this.stopLossOrder) {
      try {
        await this._cancelStopLoss();
      } catch (err) {
        log(`${this.contractCode} position error:`, err);
      }
    }

    await this.placeStopLoss(stopLossPrice);
  }

  async checkOrderUpdate(orderNotification: OrderNotification) {
    const { order_id_str, status, client_order_id, order_source, price } =
      orderNotification;

    // Action with the position itself
    if (order_id_str === this.orderId) {
      if (status === OrderStatus.FULLY_MATCHED) {
        this.entryPrice = price;

        log(`${this.contractCode}: Opened a position.`);
        log(`Entry price - ${this.entryPrice}`);
        log(`Volume - ${this.volume}`);
        log("");
        this.state = PositionState.OPEN;

        await this.placeStopLoss(this.stopLossPrice);
      }
    }

    // Action with stop loss order
    if (
      client_order_id === this.stopLossOrder?.order_id &&
      order_source === OrderSource.TPSL
    ) {
      switch (status) {
        case OrderStatus.FULLY_MATCHED:
          log(`${this.contractCode}: Closed a position.`);
          log(`Entry price - ${this.entryPrice}`);
          log(`Volume - ${this.volume}`);
          log(`Closed price - ${price}`);
          log(
            `Deviation - ${toFixed(
              calculatePercentageDifference(this.entryPrice, price),
              2
            )}%`
          );
          log("");
          this.state = PositionState.CLOSED;
          break;
        case OrderStatus.SUBMITTED:
          this.state = PositionState.CLOSING;
          break;
        default:
          break;
      }
    }
  }

  abstract _placeOrder(): Promise<void>;
  abstract placeStopLoss(price: number): Promise<void>;

  async _cancelStopLoss(): Promise<void> {
    if (!this.stopLossOrder) {
      throw new Error(
        `${this.contractCode} position tried to cancel stop loss order without ID`
      );
    }

    const response = await cancelStopLossTakeProfit({
      contract_code: this.contractCode,
      order_id: this.stopLossOrder.order_id_str,
    });

    const { errors } = response.data.data;

    if (errors.length !== 0) {
      throw new Error(errors.map((error) => error.err_msg).join(", "));
    }

    this.setStopLoss(null);
  }

  setStopLoss(order: SLTLOrderDigest | null) {
    this.stopLossOrder = order;
  }

  isInitialized() {
    return this.state === PositionState.INITIALIZED;
  }

  isOpen() {
    return this.state === PositionState.OPEN;
  }

  isClosed() {
    return this.state === PositionState.CLOSED;
  }
}
