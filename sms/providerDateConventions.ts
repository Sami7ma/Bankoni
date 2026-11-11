import type { SmsProviderId } from './types';

/** Conventions represented by the repository's sanitized fixtures, not guesses about a bank. */
export const PROVIDER_DATE_CONVENTIONS: Record<SmsProviderId, { calendar: 'Gregorian'; timezone: '+03:00'; formats: readonly string[]; note?: string }> = {
    cbe: { calendar:'Gregorian',timezone:'+03:00',formats:['dmy_date','dmy_24'] },
    telebirr: { calendar:'Gregorian',timezone:'+03:00',formats:['dmy_date','dmy_24','ymd_24'] },
    dashen: { calendar:'Gregorian',timezone:'+03:00',formats:['dmy_12'] },
    mpesa: { calendar:'Gregorian',timezone:'+03:00',formats:['dmy_12'] },
    awash: { calendar:'Gregorian',timezone:'+03:00',formats:['ymd_24'] },
    boa: { calendar:'Gregorian',timezone:'+03:00',formats:[],note:'Verified debit fixture supplies no event date; original receive time only.' },
    cbe_birr: { calendar:'Gregorian',timezone:'+03:00',formats:[],note:'Existing parser classifies package notifications as non-ledger.' },
};
export function supportedProviderDate(provider: SmsProviderId, raw: string): boolean {
    const year=raw.match(/^(?:\d{1,2}\/){2}(\d+)/)?.[1];
    if(year && (provider==='mpesa' ? ![2,4].includes(year.length) : year.length!==4))return false;
    const form = /^\d{4}-/.test(raw) ? (/\d:\d/.test(raw) ? 'ymd_24' : 'ymd_date')
        : /[AP]M$/i.test(raw) ? 'dmy_12' : /\d:\d/.test(raw) ? 'dmy_24' : 'dmy_date';
    return PROVIDER_DATE_CONVENTIONS[provider].formats.includes(form);
}
