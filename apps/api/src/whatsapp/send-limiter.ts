import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Pembatas kirim di memori proses: jeda minimum antar pesan per sesi (+ acak) dan batas per menit
 * per chat dan per sesi. Dengan beberapa replika API, batas berlaku per replika.
 */
export class SendLimiter {
  private readonly lastSent = new Map<string, number>();
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly opts: {
      minIntervalMs: number;
      jitterMs: number;
      perChatPerMinute: number;
      perSessionPerMinute: number;
    },
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Melempar 429 bila terlalu cepat atau melewati batas; bila lolos, kirim dicatat. */
  take(sessionKey: string, chatKey: string) {
    const t = this.now();
    const wait =
      (this.lastSent.get(sessionKey) ?? 0) +
      this.opts.minIntervalMs +
      this.random() * this.opts.jitterMs -
      t;
    if (wait > 0)
      this.reject(
        'send_too_fast',
        'Terlalu cepat. Tunggu sebentar sebelum mengirim lagi.',
        Math.ceil(wait / 1000),
      );
    const chat = this.recent(`c:${chatKey}`, t);
    const session = this.recent(`s:${sessionKey}`, t);
    if (
      chat.length >= this.opts.perChatPerMinute ||
      session.length >= this.opts.perSessionPerMinute
    )
      this.reject(
        'send_rate_limited',
        'Batas pengiriman per menit tercapai. Coba lagi sebentar lagi.',
        30,
      );
    chat.push(t);
    session.push(t);
    this.lastSent.set(sessionKey, t);
  }

  private recent(key: string, t: number) {
    const list = (this.windows.get(key) ?? []).filter((x) => t - x < 60_000);
    this.windows.set(key, list);
    return list;
  }

  private reject(code: string, message: string, retryAfter: number): never {
    throw new HttpException(
      { statusCode: 429, message, code, retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
      { cause: code },
    );
  }
}
