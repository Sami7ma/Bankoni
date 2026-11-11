import {scriptableHost} from '../../platform/scriptable';
import type { SmsStatus, ReviewMessage } from './native';
// Browser import is explicitly user initiated. Never load Expo's native SMS module.
export const nativeSms = null;
export async function smsStatus(): Promise<SmsStatus> { return scriptableHost() ? scriptableHost()!.request<SmsStatus>('sources.status') : { enabled: false, counts: {}, scan: {} }; }
export async function reviewMessages(): Promise<ReviewMessage[]> { return []; }
