import { describe, it, expect } from 'vitest';
import { TwiML } from '../src/twiml';

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

describe('TwiML', () => {
  it('空レスポンス', () => {
    expect(new TwiML().toString()).toBe(`${HEADER}<Response></Response>`);
  });

  it('Say は言語と音声属性を持つ', () => {
    expect(new TwiML().say('こんにちは').toString())
      .toBe(`${HEADER}<Response><Say language="ja-JP" voice="Polly.Mizuki">こんにちは</Say></Response>`);
  });

  it('Gather は子のSayを含む', () => {
    const out = new TwiML().gather('/router', 1, (g) => g.say('1を押して')).toString();
    expect(out).toBe(`${HEADER}<Response><Gather action="/router" numDigits="1"><Say language="ja-JP" voice="Polly.Mizuki">1を押して</Say></Gather></Response>`);
  });

  it('Record', () => {
    const out = new TwiML().record('/hangup', '/dial?x=1', 50).toString();
    expect(out).toContain('<Record action="/hangup" recordingStatusCallback="/dial?x=1" recordingStatusCallbackMethod="GET" maxLength="50"></Record>');
  });

  it('Reject / Hangup / Redirect / Play / Pause', () => {
    expect(new TwiML().reject().toString()).toContain('<Reject></Reject>');
    expect(new TwiML().hangup().toString()).toContain('<Hangup></Hangup>');
    expect(new TwiML().redirect('/main').toString()).toContain('<Redirect>/main</Redirect>');
    expect(new TwiML().play('http://x/a.mp3').toString()).toContain('<Play>http://x/a.mp3</Play>');
    expect(new TwiML().pause(1).toString()).toContain('<Pause length="1"></Pause>');
  });

  it('特殊文字をエスケープ', () => {
    expect(new TwiML().say('a&b<c>').toString())
      .toContain('<Say language="ja-JP" voice="Polly.Mizuki">a&amp;b&lt;c&gt;</Say>');
  });
});
