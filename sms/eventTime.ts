import { readCbeEventDate } from './cbeEventTime';
import { parseEthiopianDateTime, normalizeSmsText } from './cleaners';
import { supportedProviderDate } from './providerDateConventions';
import type { SmsProviderId } from './types';
export type DatePrecision = 'day' | 'minute' | 'second' | 'millisecond';

export type DateSource = 'sms_event' | 'sms_received' | 'manual' | 'legacy';
export type EventTimeResult = { valid: true; occurredAt: number; receivedAt: number; dateSource: DateSource; datePrecision: DatePrecision; eventDate?: string }
    | { valid: false; reason: string };
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
export function validReceivedTimestamp(value: number, now = Date.now()): boolean {
    // Android DATE is already milliseconds. Reject seconds, microseconds, NaN and future clocks.
    return Number.isSafeInteger(value) && value >= MIN_TIMESTAMP && value <= now + 5 * 60_000;
}
export function parseManualEventDate(value: string, now = Date.now()): number | null {
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value.trim());
    if (!match) return null;
    const [,year,month,day,hour,minute,second,offset]=match;
    if (+month<1 || +month>12 || +day<1 || +day>new Date(Date.UTC(+year,+month,0)).getUTCDate() || +hour>23 || +minute>59 || +(second ?? 0)>59) return null;
    if (offset !== 'Z') { const [hours,minutes]=offset.slice(1).split(':').map(Number); if (hours>14 || minutes>59 || (hours===14 && minutes!==0)) return null; }
    const epoch=Date.parse(value.trim());
    return validReceivedTimestamp(epoch,now) ? epoch : null;
}
export function resolveEventTime(body: string, receivedAt: number, parsedDate?: string, now = Date.now(), provider?: SmsProviderId): EventTimeResult {
    body = normalizeSmsText(body);
    if (/\b(?:Ethiopian\s+calendar|E\.?C\.?)(?=\s|$)|ዓ\.?ም/i.test(body)) return { valid:false,reason:'Ethiopian-calendar dates are not verified for this template; confirm the Gregorian date manually' };
    if (!validReceivedTimestamp(receivedAt, now)) return { valid: false, reason: 'A trustworthy SMS received timestamp in milliseconds is required' };
    if(provider==='cbe') {
        const event=readCbeEventDate(body);
        if(event.state==='invalid')return {valid:false,reason:event.reason};
        const occurredAt=event.state==='valid' ? Date.parse(event.iso):receivedAt;
        if(occurredAt<MIN_TIMESTAMP || occurredAt>receivedAt+300_000 || occurredAt>now+300_000)return {valid:false,reason:'CBE event date is invalid or later than receipt.'};
        return {valid:true,occurredAt,receivedAt,dateSource:event.state==='valid' ? 'sms_event':'sms_received',
            datePrecision:event.state==='valid' ? event.precision:'millisecond',eventDate:event.state==='valid' ? event.eventDate:undefined};
    }
    // These are calendar formats already used by the supported Ethiopian providers.
    const datePattern=/\b(\d{4}-\d{1,2}-\d{1,2}(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?|\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?)\b/gi;
    const matches=[...body.matchAll(datePattern)];
    const explicit=matches[0]?.[1];
    if(new Set(matches.map(m=>m[1])).size>1)return {valid:false,reason:'Several explicit dates are present; confirm the financial event date'};
    if(explicit) {
        const tail=body.slice(matches[0].index!+matches[0][0].length);
        if(/^\s+(?:at\s+|\d{1,2}[h.:]\d)|^(?:\s*(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT)\b)|^\.\d/.test(tail))return {valid:false,reason:'The explicit date includes an unsupported time or timezone; confirm it manually'};
    }
    let iso = parsedDate;
    let precision: DatePrecision = 'millisecond';
    let eventDate: string | undefined;
    if (explicit) {
        if (provider && !supportedProviderDate(provider, explicit)) return {valid:false,reason:'This date convention is not verified for the selected provider template'};
        precision = /\d{1,2}:\d{2}:\d{2}/.test(explicit) ? 'second' : /\d{1,2}:\d{2}/.test(explicit) ? 'minute' : 'day';
        let date = explicit;
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) date += ' 00:00:00';
        else if (!/[AP]M$/i.test(date)) date = date.replace(/\s+at\s+/i, ' ');
        else if (!/\sat\s/i.test(date)) date = date.replace(/\s+(?=\d{1,2}:)/, ' at ');
        iso = parseEthiopianDateTime(date) ?? undefined;
        if (!iso) return { valid: false, reason: 'The explicit transaction date is invalid; confirm it before importing' };
        if (precision === 'day') eventDate = iso.slice(0,10);
    } else if (!iso) {
        if (/\b(?:\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2}-\d{2,4})\b|\bon\s+\d{1,2}\s+[A-Za-z]+\s+\d{2,4}\b/i.test(body)) {
            return { valid:false,reason:'The explicit transaction date uses an unsupported format; confirm it before importing' };
        }
        const short = body.match(/\bon\s+(\d{1,2})\/(\d{1,2})(?!\/\d)(?:\s+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([AP]M))?)?\b/i);
        if (short) {
            if (provider) return {valid:false,reason:'Yearless dates are not verified for this provider'};
            precision = short[3] ? short[3].split(':').length === 3 ? 'second' : 'minute' : 'day';
            const year = new Date(receivedAt + 3 * 3600_000).getUTCFullYear();
            const possible = [year - 1, year, year + 1].flatMap(y => {
                const date = parseEthiopianDateTime(`${short[1]}/${short[2]}/${y}${short[3] ? `${short[4] ? ' at ' : ' '}${short[3]}${short[4] ? ` ${short[4]}` : ''}` : ''}`);
                const ms = date ? Date.parse(date) : NaN;
                return ms <= receivedAt + 300_000 && receivedAt - ms < 183 * 86400_000 ? [date!] : [];
            });
            if (possible.length !== 1) return { valid: false, reason: 'The year of this transaction needs confirmation' };
            iso = possible[0];
            if (precision === 'day') eventDate = iso.slice(0,10);
        }
    }
    const occurredAt = iso ? Date.parse(iso) : receivedAt;
    if (!Number.isFinite(occurredAt) || occurredAt < MIN_TIMESTAMP || occurredAt > receivedAt + 300_000 || occurredAt > now + 300_000) {
        return { valid: false, reason: 'The transaction date is invalid or later than its received timestamp' };
    }
    return { valid: true, occurredAt, receivedAt, dateSource: iso ? 'sms_event' : 'sms_received', datePrecision: precision, eventDate };
}

/** Manual correction accepts an honest calendar date or a timestamp with explicit offset. */
export function parseManualEventInput(value: string, now = Date.now()): {iso:string; datePrecision:DatePrecision; eventDate?:string} | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
        if(date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d || !validReceivedTimestamp(date.getTime(),now))return null;
        return {iso:date.toISOString(),datePrecision:'day',eventDate:value};
    }
    const ms=parseManualEventDate(value,now);
    return ms==null ? null : {iso:new Date(ms).toISOString(),datePrecision:/\.\d+/.test(value) ? 'millisecond' : /:\d{2}:\d{2}/.test(value) ? 'second' : 'minute'};
}
