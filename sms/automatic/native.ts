import { requireOptionalNativeModule } from 'expo-modules-core';
import type { IncomingSms } from './plan';
export interface ReviewMessage extends IncomingSms { status: string; reason: string }
export interface SmsStatus {
    enabled: boolean; counts: Partial<Record<'pending' | 'imported' | 'duplicate' | 'skipped' | 'review' | 'failed', number>>;
    scan: Record<string, string>;
}
interface NativeSms {
    status(): Promise<string>; setEnabled(enabled: boolean): Promise<void>;
    startScan(reset: boolean): Promise<void>; recover(): Promise<void>; pending(limit: number): Promise<string>;
    reviews(): Promise<string>; finish(id: string, status: string, reason: string): Promise<void>;
    retry(): Promise<void>; enqueue(body: string, sender: string, receivedAt: number, source: string): Promise<boolean>;
}
export const nativeSms = requireOptionalNativeModule<NativeSms>('BanKoniSms');
export async function smsStatus(): Promise<SmsStatus> {
    if (!nativeSms) return { enabled: false, counts: {}, scan: {} };
    return JSON.parse(await nativeSms.status());
}
export async function reviewMessages(): Promise<ReviewMessage[]> {
    return nativeSms ? JSON.parse(await nativeSms.reviews()) : [];
}
