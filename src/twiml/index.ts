const LANG = 'ja-JP';
const VOICE = 'Polly.Mizuki';
const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sayXml(text: string): string {
  return `<Say language="${LANG}" voice="${VOICE}">${esc(text)}</Say>`;
}

export class Gather {
  constructor(private parts: string[]) {}
  say(text: string): this {
    this.parts.push(sayXml(text));
    return this;
  }
}

export class TwiML {
  private parts: string[] = [];

  say(text: string): this {
    this.parts.push(sayXml(text));
    return this;
  }

  gather(action: string, numDigits: number, build: (g: Gather) => void): this {
    const inner: string[] = [];
    build(new Gather(inner));
    this.parts.push(`<Gather action="${esc(action)}" numDigits="${numDigits}">${inner.join('')}</Gather>`);
    return this;
  }

  record(action: string, recordingStatusCallback: string, maxLength: number): this {
    this.parts.push(
      `<Record action="${esc(action)}" recordingStatusCallback="${esc(recordingStatusCallback)}" recordingStatusCallbackMethod="GET" maxLength="${maxLength}"></Record>`,
    );
    return this;
  }

  play(url: string): this { this.parts.push(`<Play>${esc(url)}</Play>`); return this; }
  pause(length: number): this { this.parts.push(`<Pause length="${length}"></Pause>`); return this; }
  redirect(url: string): this { this.parts.push(`<Redirect>${esc(url)}</Redirect>`); return this; }
  reject(): this { this.parts.push('<Reject></Reject>'); return this; }
  hangup(): this { this.parts.push('<Hangup></Hangup>'); return this; }

  toString(): string {
    return `${HEADER}<Response>${this.parts.join('')}</Response>`;
  }
}
