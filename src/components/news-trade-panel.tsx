"use client";

import { useState } from "react";
import { LockKeyhole, LockKeyholeOpen, ShieldCheck, X } from "lucide-react";
import { formatNewsPrice, formatNewsMoney } from "@/lib/news-terminal-client";
import type {
  NewsMarket,
  TradeRequest,
  TradeStatus,
  TradeVenue,
} from "@/lib/news-terminal-types";
import styles from "./news-terminal.module.css";

export type OrderDraft = {
  notional: number;
  leverage: number;
  type: "market" | "limit";
  limitPrice: string;
  stopLoss: string;
  takeProfit: string;
};

export function NewsTradePanel({
  symbol,
  venue,
  market,
  status,
  draft,
  setDraft,
  busy,
  confirmation,
  onOrder,
  onUnlock,
  onLock,
}: {
  symbol: string;
  venue: TradeVenue;
  market: NewsMarket | null;
  status: TradeStatus | null;
  draft: OrderDraft;
  setDraft: (draft: OrderDraft) => void;
  busy: boolean;
  confirmation: string | null;
  onOrder: (side: "buy" | "sell") => void;
  onUnlock: (pin: string) => Promise<void>;
  onLock: () => void;
}) {
  const [pin, setPin] = useState("");
  const account = status?.accounts.find((account) => account.venue === venue);
  const canSubmit =
    !busy &&
    status?.enabled &&
    status.mode === "live" &&
    status.unlocked &&
    account?.connected &&
    market?.pair &&
    market.symbol === symbol &&
    market.venue === venue &&
    !market.error;
  return (
    <div className={styles.tradeForm} data-news-trade-form>
      <div className={styles.accountBalance}>
        <span>可用保证金</span>
        <strong>
          {formatNewsPrice(account?.availableBalance)}{" "}
          <small>{venue === "binance" ? "USDT" : "USDC"}</small>
        </strong>
      </div>
      <div className={styles.orderMode} role="group" aria-label="订单类型">
        {(["market", "limit"] as const).map((type) => (
          <button
            key={type}
            aria-pressed={draft.type === type}
            onClick={() => setDraft({ ...draft, type })}
          >
            {type === "market" ? "市价" : "限价"}
          </button>
        ))}
      </div>
      <label className={styles.field}>
        名义价值 <span>{venue === "binance" ? "USDT" : "USDC"}</span>
        <input
          aria-label="下单名义价值"
          type="number"
          min="1"
          max={status?.limits.maxOrderNotional || 500}
          value={draft.notional}
          onChange={(event) =>
            setDraft({ ...draft, notional: Number(event.target.value) })
          }
        />
      </label>
      <div className={styles.amountPresets}>
        {[50, 100, 200, 500].map((amount) => (
          <button
            key={amount}
            disabled={amount > (status?.limits.maxOrderNotional || 500)}
            aria-pressed={draft.notional === amount}
            onClick={() => setDraft({ ...draft, notional: amount })}
          >
            {amount}
          </button>
        ))}
      </div>
      {draft.type === "limit" ? (
        <label className={styles.field}>
          限价
          <input
            aria-label="限价"
            type="number"
            min="0"
            step="any"
            value={draft.limitPrice}
            onChange={(event) =>
              setDraft({ ...draft, limitPrice: event.target.value })
            }
          />
        </label>
      ) : null}
      <div className={styles.leverageRow}>
        <label>
          杠杆{" "}
          <select
            aria-label="杠杆"
            value={draft.leverage}
            onChange={(event) =>
              setDraft({ ...draft, leverage: Number(event.target.value) })
            }
          >
            {[1, 2, 3, 4, 5]
              .filter((v) => v <= (status?.limits.maxLeverage || 5))
              .map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
          </select>
        </label>
        <span>逐仓</span>
      </div>
      <div className={styles.protectionFields}>
        <label className={styles.field}>
          止损 %
          <input
            aria-label="止损百分比"
            type="number"
            step=".1"
            min=".1"
            max="50"
            placeholder="可选"
            value={draft.stopLoss}
            onChange={(event) =>
              setDraft({ ...draft, stopLoss: event.target.value })
            }
          />
        </label>
        <label className={styles.field}>
          止盈 %
          <input
            aria-label="止盈百分比"
            type="number"
            step=".1"
            min=".1"
            max="99"
            placeholder="可选"
            value={draft.takeProfit}
            onChange={(event) =>
              setDraft({ ...draft, takeProfit: event.target.value })
            }
          />
        </label>
      </div>
      <div className={styles.orderEstimate}>
        <span>预计保证金</span>
        <span>
          {formatNewsPrice(draft.notional / draft.leverage)}{" "}
          {venue === "binance" ? "USDT" : "USDC"}
        </span>
      </div>
      <div className={styles.sideButtons}>
        <button
          className={styles.longButton}
          disabled={!canSubmit}
          onClick={() => onOrder("buy")}
        >
          {busy ? "提交中" : confirmation === "buy" ? "确认开多" : "开多"}
        </button>
        <button
          className={styles.shortButton}
          disabled={!canSubmit}
          onClick={() => onOrder("sell")}
        >
          {busy ? "提交中" : confirmation === "sell" ? "确认开空" : "开空"}
        </button>
      </div>
      <div className={styles.tradeGate}>
        {!status?.unlocked ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await onUnlock(pin);
                setPin("");
              } catch {
                /* The parent displays the error. */
              }
            }}
          >
            <label htmlFor="trade-pin">
              <LockKeyhole size={13} />
              交易解锁
            </label>
            <div>
              <input
                id="trade-pin"
                aria-label="交易 PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="交易 PIN"
                value={pin}
                maxLength={128}
                onChange={(event) => setPin(event.target.value)}
              />
              <button
                disabled={busy || !pin || !status?.csrfToken}
                type="submit"
              >
                解锁
              </button>
            </div>
          </form>
        ) : (
          <button
            className={styles.lockButton}
            onClick={onLock}
            disabled={busy}
          >
            <LockKeyholeOpen size={13} />
            已解锁
            <LockKeyhole size={13} />
            锁定
          </button>
        )}
      </div>
      <p className={styles.gateReason}>
        {!status?.enabled
          ? "交易服务未启用"
          : status.mode !== "live"
            ? "账户只读"
            : !account?.configured
              ? "当前账户待配置"
              : !account.connected
                ? "账户连接中断"
                : !market?.pair
                  ? "当前账户暂无此合约"
                  : !status.unlocked
                    ? "输入交易 PIN 后可下单"
                    : `单笔上限 ${status.limits.maxOrderNotional} · 滑点 ${status.limits.slippagePct}%`}
      </p>
      <div className={styles.riskFootnote}>
        <ShieldCheck size={13} />
        <span>
          单币 {formatNewsMoney(status?.limits.maxSymbolNotional)} · 总仓{" "}
          {formatNewsMoney(status?.limits.maxTotalNotional)} · 日亏{" "}
          {formatNewsMoney(status?.limits.maxDailyLoss)}
        </span>
      </div>
      {account?.error ? (
        <p className={styles.errorText}>{account.error}</p>
      ) : null}
    </div>
  );
}

export function NewsPositions({
  status,
  venue,
  busy,
  onOrder,
  onCancel,
  onCloseAll,
}: {
  status: TradeStatus | null;
  venue: TradeVenue;
  busy: boolean;
  onOrder: (order: Partial<TradeRequest>) => void;
  onCancel: (symbol: string, id: string) => void;
  onCloseAll: () => void;
}) {
  const [tab, setTab] = useState("positions");
  const [confirmClose, setConfirmClose] = useState(false);
  const account = status?.accounts.find((account) => account.venue === venue);
  const positions = account?.positions || [];
  const orders = account?.orders || [];
  const fills = status?.fills?.filter(fill => fill.venue === venue) || [];
  const logs = status?.logs.filter(log => log.venue === venue) || [];
  const canTrade = Boolean(
    status?.enabled &&
    status.unlocked &&
    status.mode === "live" &&
    account?.connected &&
    !busy,
  );
  return (
    <section className={styles.positions} data-news-positions>
      <div className={styles.positionToolbar}>
        <div
          className={styles.positionTabs}
          role="tablist"
          aria-label="账户记录"
        >
          {[
            ["positions", `持仓 ${positions.length}`],
            ["orders", `挂单 ${orders.length}`],
            ["fills", "成交"],
            ["logs", "日志"],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          disabled={!canTrade || (!positions.length && !orders.length)}
          className={styles.closeAll}
          onClick={() => setConfirmClose(true)}
        >
          全部平仓
        </button>
      </div>
      {tab === "positions" ? (
        positions.length ? (
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>合约 / 方向</th>
                  <th>名义价值</th>
                  <th>入场 / 标记</th>
                  <th>未实现盈亏</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={`${position.symbol}-${position.side}`}>
                    <td>
                      <strong>{position.symbol}</strong>
                      <span
                        className={
                          position.side === "long"
                            ? styles.positive
                            : styles.negative
                        }
                      >
                        {position.side === "long" ? " 多" : " 空"}{" "}
                        {position.leverage}×
                      </span>
                    </td>
                    <td>{formatNewsMoney(position.notional)}</td>
                    <td>
                      {formatNewsPrice(position.entryPrice)}
                      <br />
                      <small>{formatNewsPrice(position.markPrice)}</small>
                    </td>
                    <td
                      className={
                        position.unrealizedPnl >= 0
                          ? styles.positive
                          : styles.negative
                      }
                    >
                      {position.unrealizedPnl >= 0 ? "+" : ""}
                      {formatNewsPrice(position.unrealizedPnl)}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          disabled={!canTrade}
                          onClick={() =>
                            onOrder({
                              symbol: position.symbol,
                              side: position.side === "long" ? "sell" : "buy",
                              type: "market",
                              reduceOnly: true,
                              closeFraction: 0.5,
                              notional: position.notional / 2,
                              leverage: position.leverage,
                            })
                          }
                        >
                          平一半
                        </button>
                        <button
                          disabled={!canTrade}
                          onClick={() =>
                            onOrder({
                              symbol: position.symbol,
                              side: position.side === "long" ? "sell" : "buy",
                              type: "market",
                              reduceOnly: true,
                              closeFraction: 1,
                              notional: position.notional,
                              leverage: position.leverage,
                            })
                          }
                        >
                          平仓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptySmall}>当前账户暂无持仓</div>
        )
      ) : null}
      {tab === "orders" ? (
        orders.length ? (
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>合约</th>
                  <th>方向 / 类型</th>
                  <th>价格 / 数量</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.symbol}</td>
                    <td>
                      {order.side} / {order.type}
                    </td>
                    <td>
                      {formatNewsPrice(order.price)} /{" "}
                      {formatNewsPrice(order.size)}
                    </td>
                    <td>{order.status}</td>
                    <td>
                      <button
                        disabled={!canTrade}
                        aria-label={`撤销 ${order.symbol} 挂单`}
                        title="撤单"
                        className={styles.iconButton}
                        onClick={() => onCancel(order.symbol, order.id)}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptySmall}>暂无挂单</div>
        )
      ) : null}
      {tab === "fills" ? (
        fills.length ? <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>时间</th><th>合约 / 方向</th><th>成交均价</th><th>数量</th></tr></thead>
            <tbody>{fills.map(fill => <tr key={fill.id}>
              <td>{new Date(fill.createdAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</td>
              <td>{fill.symbol} <span className={fill.side === "buy" ? styles.positive : styles.negative}>{fill.side === "buy" ? "买" : "卖"}</span></td>
              <td>{formatNewsPrice(fill.price)}</td>
              <td>{formatNewsPrice(fill.size)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className={styles.emptySmall}>暂无本站成交</div>
      ) : null}
      {tab === "logs" ? (
        <div className={styles.tradeLogs}>
          {logs.length ? (
            logs.map((log) => (
              <div key={log.id}>
                <time>
                  {new Date(log.createdAt).toLocaleTimeString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })}
                </time>
                <strong>{log.symbol}</strong>
                <span>{log.message}</span>
                <small>{log.status}</small>
              </div>
            ))
          ) : (
            <div className={styles.emptySmall}>暂无交易记录</div>
          )}
        </div>
      ) : null}
      {account?.updatedAt ? (
        <div className={styles.accountUpdated}>
          账户同步{" "}
          {new Date(account.updatedAt).toLocaleTimeString("zh-CN", {
            hour12: false,
            timeZone: "Asia/Shanghai",
          })}
        </div>
      ) : null}
      {confirmClose ? (
        <div className={styles.modalBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-all-title"
            className={styles.confirmDialog}
          >
            <h3 id="close-all-title">
              平掉{venue === "binance" ? "币安" : "Hyperliquid"}全部持仓？
            </h3>
            <p>将撤销当前账户全部挂单，并平掉 {positions.length} 个持仓。</p>
            <div>
              <button onClick={() => setConfirmClose(false)}>取消</button>
              <button
                className={styles.shortButton}
                disabled={!canTrade}
                onClick={() => {
                  setConfirmClose(false);
                  onCloseAll();
                }}
              >
                确认全部平仓
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
