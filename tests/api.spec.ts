import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadConfig } from '../src/index';

describe('API', () => {
    it('should decrypt and load an encrypted config', async () => {
        process.env.VAR_4 = 'VAR_4_OVERRIDE';

        const config = loadConfig({
            file: `${__dirname}/fixtures/sample.enc.env`,
            key: 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC0O8fsa9mi5Hmn4pOJaOIVc3bg7s54Sq1UHcp4tTlQjPh45CZrYQYSeGjR0iAj6CkNKwW/9Lgq3+VJ7ni626N8BUXZRvJneT44p8b1MbqE9yS9Ac0xItsEvxjENbgwiUWjqsaaKuTNiiIm1WjcbDcJARyuHH0xw6ZEkdB3gGlv15yGX2nQBSChq+nRBirNolBWFUKOWDcUhjBW+vyx0KGeVbghKO/imjbBwqjdwjkW+txWeAMQeNmp1qxW/R449h7TrwFPQEvYxIR5Hnhn9WXiWUmQpZCxh8k+3XUVD78MVkChGRQCJPuv5t0e3oFrZtq/3h2jKuK06KXzgnKWbluVAgMBAAECggEAIn6aid4uXiW6Pu53bEIdmxtpMi2iaJVqTQISoT2WBZulZoXL8Js2LUzMSvQbYKPrT3DffdiZcuM9IAQ7KRAmXvMnZilU9YbX6MH7qyvkVdRzPJVerzvLjUIBvHPHl8p+AJALyK/S8J+yX5pSonU3p0qGMbCUKXUXmmIJ8wUpqNTZv6/tlzYUX80JXk95QiVfo8RAmRwD6OKZhdAREtA9vESsd0Y/3Ve9fzfJeeBzm+N/DZjftSVVbYI3G+SgzdhL17Ac48+KD4I+1WN7yMZ5IgV5h4Tl+M/BVK3qHJMsQRc1RVIXfDWC9N+GRKHTFLrr/GjkVP/ODpcOQ+0/tJ8Y9QKBgQDqczliROGuvzTUS5JDgldxq8Ro4utIaZyjAK90eBsjVgoLTaXdtPNNXyU5OU6fFzBJY7zaI7MqiGrWN2F0GjsnOkG4igm7XtbSJnCFajbTbEOzXyhbwRMjf2/9jw+9xy8D2DzJf/yLc5Fygf3WKNlaUGkZsWtbnGKK5bFlcN+4gwKBgQDEzM13ORkLWSj+JR8rvGP/pQgp32rJ89N7FRLgetSGf0VvZNCqi7VYO0zIaVNtAlHpmzHrD/puhDEF8P9aJRNjhtBnHwxcCuSbc3i3iD1w9W3Tz4Nr+FGpg8PIvpH1d8fQdYUauRStqUqtkvoa/gRAbGskcF4hjI0b883ViF1wBwKBgDuCcc9iwpIzkHpOkFq4a++7dMhWyPgBbrPlSaPblK/ceAI0fGSROKyr+OvUgwNYxHXsbhREuYaTR+MF/aOVwOwNGn938k5wHUEMZsVGl5IEyg5umfToRi5de5S1yn4WX/Wu3ocbCIRxGjshicfhaIJHJNZTtXd0c4LkGKoyA2d3AoGBAIDCut/5hLBPGqoFobpc3VSDJq821Uji9gg+xoYG94w0MzrpzDj5haH/0oIBn6rf7LYaa3OvlZu/c8++WWQig+gHac0+nDiQi/hFecMjKYgBnGUMDaGT6+IsKunp/deMEjkK2xab57Kj5A9i7a7Bagi4pvVFa+Epc53JS3Adc3z7AoGBAKuztVKmOch9ZSt85CdxQNNUUSVLEKZCEPUvdrF+KNgtDjKFlXglGiXVZEp6IIqbA9PaPPNoLduHywQosY/kQu4YgLCXznSP2fDssSmi/RPMTESLqFM08l0W/04q8kDrhJmHPSfqPu9jpwb2HkR4D08eCRANpCNt6wm4LocrZ/NB'
        });

        const expected = {
            VAR_1: 'a',
            VAR_2: 'b',
            VAR_3_SECRET: 'the quick brown fox jumps over the lazy dog',
            VAR_4: 'VAR_4_OVERRIDE',
            VAR_5_SECRET: 'supercalifragilisticexpialidocious',
            BLANK_VAR: ''
        };

        for (const [key, value] of Object.entries(expected)) {
            assert.strictEqual(config[key], value, `config.${key} should equal ${JSON.stringify(value)}`);
        }
    });

    it('should load a config with no encryption', async () => {
        const config = loadConfig({
            file: `${__dirname}/fixtures/sample.env`
        });

        const expected = {
            VAR_1: 'a',
            VAR_2: 'b',
            VAR_3_SECRET: 'the quick brown fox jumps over the lazy dog',
            VAR_4: 'VAR_4_OVERRIDE',
            VAR_5_SECRET: 'supercalifragilisticexpialidocious',
            BLANK_VAR: ''
        };

        for (const [key, value] of Object.entries(expected)) {
            assert.strictEqual(config[key], value, `config.${key} should equal ${JSON.stringify(value)}`);
        }
    });

    it('should throw if the config is encrypted and no key is provided', async () => {
        assert.throws(
            () => {
                loadConfig({
                    file: `${__dirname}/fixtures/sample.enc.env`
                });
            },
            { message: /No decryption key was provided/ }
        );
    });
});
