import { renderOutboundMessage } from './message-template';

describe('outbound message personalisation', () => {
  it('renders names, handles, URLs and configured links before sending', () => {
    expect(
      renderOutboundMessage(
        'Hai {{nama}}, dari @{{akun}}. Link: {{https://www.sg-berjangka.com/id}}',
        { nama: 'Sarah', akun: 'bonoinn' },
      ),
    ).toBe('Hai Sarah, dari @bonoinn. Link: https://www.sg-berjangka.com/id');
    expect(
      renderOutboundMessage('Halo {{nama}}, buka {{link}}', {
        nama: 'Luna',
        link: 'https://example.com/daftar',
      }),
    ).toBe('Halo Luna, buka https://example.com/daftar');
  });
  it('rejects missing links and unknown variables instead of sending incomplete text', () => {
    expect(() => renderOutboundMessage('Halo {{nama}}, buka {{link}}', { nama: 'Sarah' })).toThrow(
      'URL lengkap',
    );
    expect(() => renderOutboundMessage('Halo {{bonus}} ya', {})).toThrow(
      'Variabel template tidak dikenal',
    );
    expect(() => renderOutboundMessage('Halo {{nama salah}} ya', {})).toThrow(
      'Variabel template tidak dikenal',
    );
  });
  it('checks the final length after replacing a short variable with a long value', () => {
    expect(() => renderOutboundMessage('Halo {{nama}}', { nama: 'x'.repeat(2000) })).toThrow(
      '2000',
    );
  });
});
