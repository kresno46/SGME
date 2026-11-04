import { HttpException } from '@nestjs/common';
import { SendLimiter } from './send-limiter';

const limits = { minIntervalMs: 1000, jitterMs: 0, perChatPerMinute: 2, perSessionPerMinute: 3 };

describe('SendLimiter', () => {
  it('menolak pesan yang terlalu cepat per sesi, lalu meloloskan setelah jeda', () => {
    let now = 1_000_000;
    const l = new SendLimiter(
      limits,
      () => now,
      () => 0,
    );
    l.take('s1', 'c1');
    expect(() => l.take('s1', 'c2')).toThrow(HttpException);
    expect(() => l.take('s2', 'c9')).not.toThrow();
    now += 1000;
    expect(() => l.take('s1', 'c2')).not.toThrow();
  });

  it('membatasi per chat dan per sesi dalam satu menit', () => {
    let now = 1_000_000;
    const l = new SendLimiter(
      limits,
      () => now,
      () => 0,
    );
    l.take('s1', 'c1');
    now += 1000;
    l.take('s1', 'c1');
    now += 1000;
    expect(() => l.take('s1', 'c1')).toThrow(/Batas pengiriman/);
    l.take('s1', 'c2');
    now += 1000;
    expect(() => l.take('s1', 'c3')).toThrow(/Batas pengiriman/);
    now += 60_000;
    expect(() => l.take('s1', 'c1')).not.toThrow();
  });
});
