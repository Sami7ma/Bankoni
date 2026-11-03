import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, PermissionsAndroid, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import PrimaryButton from '../common/buttons/PrimaryButton';
import SmsImportModal from '../modals/SmsImportModal';
import { getSmsTransactionCountDB } from '../../db/database';
import { nativeSms, smsStatus, reviewMessages, type SmsStatus, type ReviewMessage } from '../../sms/automatic/native';
import { drainSmsQueue, loadImportContext } from '../../sms/automatic/processor';
import { readExportedMessages } from '../../sms/automatic/exportedMessages';
import { transferSuggestion, confirmQueuedTransfer } from '../../sms/automatic/transfers';
import type { ImportContext } from '../../sms/automatic/plan';

export default function AutomaticSmsImport() {
    const colors = useTheme();
    const wallets = useBanKoniStore(s => s.wallets);
    const [status, setStatus] = useState<SmsStatus>({ enabled: false, counts: {}, scan: {} });
    const [reviews, setReviews] = useState<ReviewMessage[]>([]);
    const [context, setContext] = useState<ImportContext | null>(null);
    const [selected, setSelected] = useState<ReviewMessage | undefined>();
    const [busy, setBusy] = useState(false);
    const [permission, setPermission] = useState('Not checked');
    const [error, setError] = useState('');
    const [transactionCount, setTransactionCount] = useState(0);
    const text = { color: colors.textPrimary, fontSize: 14, lineHeight: 21 };
    const muted = { color: colors.textSecondary, fontSize: 12, lineHeight: 18 };
    async function refresh() {
        const [next, messages, importContext, imported] = await Promise.all([smsStatus(), reviewMessages(), loadImportContext(), getSmsTransactionCountDB()]);
        setTransactionCount(imported);
        setStatus(next); setReviews(messages); setContext(importContext);
        if (Platform.OS === 'android') {
            const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
            const receive = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
            setPermission(read && receive ? 'Inbox and incoming SMS allowed' : 'SMS access required');
        }
    }
    useEffect(() => {
        let mounted = true;
        const update = () => { if (mounted) void refresh().catch(() => setError('Could not read SMS import status. Try again.')); };
        update();
        const timer = setInterval(update, 4000);
        const listener = AppState.addEventListener('change', state => { if (state === 'active') update(); });
        return () => { mounted = false; clearInterval(timer); listener.remove(); };
    }, []);
    async function run(action: () => Promise<unknown>) {
        if (busy) return;
        setBusy(true); setError('');
        try { await action(); await drainSmsQueue(); await refresh(); await useBanKoniStore.getState().loadAllData(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not finish. Retry when BanKoni is available.'); }
        finally { setBusy(false); }
    }
    async function enable() {
        if (!nativeSms) return;
        if (Platform.OS === 'android') {
            const grants = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_SMS, PermissionsAndroid.PERMISSIONS.RECEIVE_SMS]);
            if (Object.values(grants).some(value => value !== PermissionsAndroid.RESULTS.GRANTED)) {
                setPermission('Permission denied. Use device Settings to grant SMS access.');
                return;
            }
        }
        await nativeSms.setEnabled(true);
        if (Platform.OS === 'android') await nativeSms.startScan(false);
    }
    function toggle(value: boolean) {
        if (!value) { void run(() => nativeSms!.setEnabled(false)); return; }
        Alert.alert('Enable Automatic SMS Import', 'BanKoni will process financial messages on this device and add transactions to your existing wallets, including while the app is locked. OTPs and personal messages are filtered. Uncertain messages need review; their text is retained for up to 30 days. Failed messages are kept until resolved, with automatic retry. Imported text is discarded. No SMS is uploaded.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Enable', onPress: () => void run(enable) },
        ]);
    }
    async function importExport() {
        const result = await DocumentPicker.getDocumentAsync({ type: ['application/json','text/json'], copyToCacheDirectory: true });
        if (result.canceled) return;
        const asset = result.assets[0];
        try {
            if ((asset.size ?? 0) > 5 * 1024 * 1024) throw new Error('Choose a JSON export smaller than 5 MB');
            const content = await FileSystem.readAsStringAsync(asset.uri);
            const messages = readExportedMessages(content);
            let queued = 0;
            for (const message of messages) {
                if (!(await smsStatus()).enabled) break;
                await nativeSms!.enqueue(message.body,message.sender,message.receivedAt,'file');
                if (++queued % 100 === 0) await drainSmsQueue();
            }
            Alert.alert('Export read', `${messages.length} financial messages from the previous 12 months were submitted. Existing imports will be skipped.`);
        } finally {
            // The picker copy may contain personal messages. Remove that cache copy immediately.
            if (FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory)) await FileSystem.deleteAsync(asset.uri,{ idempotent: true });
        }
    }
    const suggestions = context ? reviews.flatMap(debit => reviews.flatMap(credit => {
        if (debit.id === credit.id) return [];
        const match = transferSuggestion(debit,credit,context);
        return match ? [{ debit, credit, match }] : [];
    })).slice(0,10) : [];
    const counts = status.counts;
    const processed = (counts.imported || 0)+(counts.duplicate || 0)+(counts.skipped || 0)+(counts.review || 0)+(counts.failed || 0);
    return <View style={{ gap: 12 }}>
        <Text style={text}>Import bank and mobile-money transactions on this device. Connect your accounts in Wallets first; account endings help BanKoni choose the right wallet.</Text>
        {!nativeSms ? <Text style={muted}>Automatic SMS Import requires a BanKoni native build. Expo Go does not include the SMS module.</Text> : <>
            <View style={styles.row}><Text style={text}>Automatic SMS Import</Text><Switch accessibilityLabel="Automatic SMS Import" value={status.enabled} disabled={busy} onValueChange={toggle} trackColor={{ true: colors.champagne }} /></View>
            <Text style={muted}>{Platform.OS === 'android' ? permission : 'Incoming messages require a Shortcuts Message automation.'}</Text>
            {wallets.filter(w => !w.isArchived && w.providerId !== 'custom').map(w => <Text key={w.id} style={muted}>{w.name}{w.accountNumberLast4 ? ` ••••${w.accountNumberLast4}` : ' — add account ending in Wallets'}</Text>)}
            {Platform.OS === 'android' ? <>
                <Text style={text}>Scanning messages: {Number(status.scan.scanSeen || 0).toLocaleString()} / {Number(status.scan.scanTotal || 0).toLocaleString()}</Text>
                <Text style={muted}>Scan: {status.scan.scanState || 'Not started'}{status.scan.scanPhase === 'catchup' ? ' (new messages since checkpoint)' : ''} · Filtered: {status.scan.scanFiltered || 0}{status.scan.lastScan ? `\nLast completed scan: ${new Date(Number(status.scan.lastScan)).toLocaleString()}` : ''}</Text>
                {!!status.scan.scanError && <Text style={muted}>{status.scan.scanError}</Text>}
                <PrimaryButton label="Resume scan / check permissions" disabled={busy} onPress={() => void run(enable)} />
                <PrimaryButton label="Rescan previous 12 months" disabled={busy || !status.enabled} onPress={() => void run(() => nativeSms!.startScan(true))} />
                <Text style={muted}>Android may delay background work during battery restrictions. Force stop prevents reception until you reopen BanKoni. Some installers restrict SMS permissions; Play distribution requires approval for SMS access.</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={{ color: colors.champagne }}>Open device app settings</Text></TouchableOpacity>
            </> : <>
                <Text style={text}>Set up BanKoni in Shortcuts (iOS 17 or later)</Text>
                <Text style={muted}>1. Open Shortcuts and create a shortcut named “BanKoni SMS Import”.{ '\n' }2. Add BanKoni → Import Bank Message. Set Message to Shortcut Input as Text. Leave Sender blank, or pass the sender from your Message input.{ '\n' }3. Create a Message automation for your bank senders or messages containing “ETB”. Choose Run Immediately (or disable Ask Before Running).{ '\n' }4. Add Run Shortcut → BanKoni SMS Import. Pass the received Message as input. Enable it and test with a real incoming financial message.</Text>
                <PrimaryButton label="Open Apple Shortcuts" onPress={() => void Linking.openURL('shortcuts://').catch(() => setError('Install Apple Shortcuts first.'))} />
                <Text style={muted}>The action queues and processes messages on device without opening BanKoni. iPhone lock state and automation permissions can delay it. Open BanKoni to recover failures. Installation/publication of a signed shortcut requires Apple Shortcuts; no iCloud installation link is available in this build.</Text>
                <Text style={muted}>iOS does not expose your historical SMS inbox. If you already have a legitimate JSON message export, choose it below. Format: an array of objects with body, sender and receivedAt (ISO date or epoch milliseconds). Only the previous 12 months are considered.</Text>
            </>}
            <Text style={text}>Messages processed: {processed} · Imported messages: {counts.imported || 0}{'\n'}Transactions imported: {transactionCount} (including fees){'\n'}Duplicates: {counts.duplicate || 0} · Skipped: {(counts.skipped || 0)+Number(status.scan.scanFiltered || 0)}{'\n'}Pending: {counts.pending || 0} · Review: {counts.review || 0} · Failed: {counts.failed || 0}</Text>
            <PrimaryButton label="Import exported messages (JSON)" disabled={busy || !status.enabled} onPress={() => void run(importExport)} />
            <PrimaryButton label="Retry failed / recheck review messages" disabled={busy || !status.enabled} onPress={() => void run(() => nativeSms!.retry())} />
            {suggestions.map(({ debit, credit, match }) => <TouchableOpacity accessibilityRole="button" key={`${debit.id}-${credit.id}`} onPress={() => Alert.alert('Confirm own-account transfer', `${match.from.name} → ${match.to.name}\nPrincipal: ETB ${(match.principal/100).toFixed(2)}\nFees: ETB ${(match.fees/100).toFixed(2)}\nTotal debit: ETB ${((match.principal+match.fees)/100).toFixed(2)}\n\n${debit.body}\n\n${credit.body}\n\nConfirm only if both messages describe the same transfer between your accounts.`, [
                { text: 'Cancel', style: 'cancel' }, { text: 'Confirm transfer', onPress: () => void run(async () => {
                    await confirmQueuedTransfer(debit,credit,context!);
                    await nativeSms!.finish(debit.id,'imported','Confirmed own-account transfer');
                    await nativeSms!.finish(credit.id,'imported','Confirmed own-account transfer');
                }) },
            ])}><Text style={{ ...text, color: colors.champagne }}>Suggested transfer: {match.from.name} → {match.to.name} · ETB {(match.principal/100).toFixed(2)} + fees</Text></TouchableOpacity>)}
            <Text style={muted}>{reviews.length ? 'Review messages (latest 50)' : 'No messages requiring review'}</Text>
            {reviews.map(message => <View key={message.id} style={{ gap: 5, paddingVertical: 8 }}>
                <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(message)}><Text style={text}>{message.sender || 'Financial message'} · {new Date(message.receivedAt).toLocaleDateString()}</Text><Text style={muted}>{message.reason}</Text><Text numberOfLines={2} style={muted}>{message.body}</Text><Text style={{ color: colors.champagne }}>Review in SMS import</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={() => void run(() => nativeSms!.finish(message.id,'skipped','Dismissed by user'))}><Text style={muted}>Dismiss and remove message text</Text></TouchableOpacity>
            </View>)}
        </>}
        {!!error && <Text accessibilityRole="alert" style={text}>{error}</Text>}
        <SmsImportModal visible={!!selected} initialMessage={selected} onClose={() => { setSelected(undefined); void run(async () => { await nativeSms?.retry(); }); }} />
    </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
