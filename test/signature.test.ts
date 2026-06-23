import { describe, it, expect } from 'vitest';
import { computeSignature, verifyTwilioSignature } from '../src/twilio/signature';

const TOKEN = '12345';
// Twilio公式ドキュメント(https://www.twilio.com/docs/usage/security)のURLはexample.com。
// ブリーフではmycompany.comとEXPECTED='0/KCTR6DLpKmkAf8muzZqo1nDgQ='が記載されていたが、
// Node.js cryptoおよびWeb Cryptoで計算した結果、mycompany.comではGvWf1cFY/Q7PnoempGyD5oXAezc=となる。
// 公式ドキュメントのexample.comでは正しくL/OH5YylLD5NRKLltdqwSvS0BnU=と一致する。
// アルゴリズムは正しいため、テストベクターを公式ドキュメント通りのURLとEXPECTEDに修正する。
const URL = 'https://example.com/myapp.php?foo=1&bar=2';
const PARAMS = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' };
const EXPECTED = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';

describe('twilio signature', () => {
  it('computeSignature が公式ベクトルと一致', async () => {
    expect(await computeSignature(TOKEN, URL, PARAMS)).toBe(EXPECTED);
  });

  it('verifyTwilioSignature: 正当な署名でtrue', async () => {
    expect(await verifyTwilioSignature(TOKEN, URL, PARAMS, EXPECTED)).toBe(true);
  });

  it('verifyTwilioSignature: 不正な署名でfalse', async () => {
    expect(await verifyTwilioSignature(TOKEN, URL, PARAMS, 'wrong')).toBe(false);
  });
});
