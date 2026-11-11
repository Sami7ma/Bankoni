import { normalizeSmsText, parseEthiopianDateTime } from './cleaners';

export type CbeEventDate = { state:'absent' } | { state:'invalid'; reason:string }
    | { state:'valid'; iso:string; precision:'day'|'minute'|'second'; eventDate?:string };

/** Only the Gregorian DMY / 24-hour convention represented by existing CBE fixtures.
 * ISO-T, AM/PM, yearless and other explicit conventions stay in review until confirmed.
 * The presence of an event-date clause is independent of successful interpretation.
 */
export function readCbeEventDate(body:string): CbeEventDate {
    const text=normalizeSmsText(body);
    if (/\b(?:Ethiopian\s+calendar|E\.?C\.?)\b|ዓ\.?ም/i.test(text)) return {state:'invalid',reason:'CBE Ethiopian-calendar dates require Gregorian confirmation.'};
    const clauses=[...text.matchAll(/\b(?:on\s+(?!your\b|account\b)|date\s*:\s*)([\s\S]+?)(?=\s+from\s+your\s+account|\s+with\s+Ref\s+No\b|[.!](?:\s|$)|\s+Your\s+(?:Current\s+)?Balance\b|$)/gi)].map(m=>m[1].trim());
    if (!clauses.length) {
        if (/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b|\b(?:at\s+(?:\d|INVALID|unknown)|dated\b|date\b)/i.test(text)) return {state:'invalid',reason:'Present CBE event date/time is not in an established date clause.'};
        return {state:'absent'};
    }
    const dates=clauses.map(clause=>{
        const m=/^(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?))?$/i.exec(clause);
        if(!m)return null;
        const iso=parseEthiopianDateTime(m[1]+(m[2] ? ' '+m[2] : ''));
        return iso ? {iso,precision:(m[2] ? m[2].split(':').length===3 ? 'second':'minute':'day') as 'day'|'minute'|'second'} : null;
    });
    if(dates.some(d=>!d) || new Set(dates.map(d=>d?.iso)).size!==1) return {state:'invalid',reason:'Present CBE event date/time is invalid, contradictory or unsupported; review it explicitly.'};
    const date=dates[0]!;
    return {state:'valid',...date,eventDate:date.precision==='day' ? date.iso.slice(0,10):undefined};
}
