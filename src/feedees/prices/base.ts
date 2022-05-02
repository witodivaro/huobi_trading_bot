import { connection } from "websocket";
import { Feedee, PriceListener } from "../types";
import { PriceData } from "../../connection/types";

abstract class BasePrice implements Feedee {
  abstract channel: string;
	private _listeners: PriceListener[] = [];
	private _latestPrice: null | number = null;

  protected handlePriceChange(price: number) {};

  init(connection: connection) {
    const requestPayload = {
			sub: this.channel,
		};

    connection.send(JSON.stringify(requestPayload));
  };


  getLatestPrice() {
    return this._latestPrice;
  }

	handleMessage(message: PriceData) {
		if (this._latestPrice !== message.tick.close) {
			this._handlePriceChange(message.tick.close);
		}
	}

	addListener(listener: PriceListener) {
		this._listeners.push(listener);
	}

	removeListener(listener: PriceListener) {
		this._listeners = this._listeners.filter((sub) => listener !== sub);
	}

  private _handlePriceChange(price: number) {
		this._latestPrice = price;
		this.handlePriceChange(price);
    this._notifyPriceListeners();
	}

	private _notifyPriceListeners() {
    if (!this._latestPrice) return;

		this._listeners.forEach((listener) => {
			listener(this._latestPrice as number);
		});
	}
}

export default BasePrice;