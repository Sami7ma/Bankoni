import { useEffect, useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import PrimaryButton from '../common/buttons/PrimaryButton';
import SmsImportModal from '../modals/SmsImportModal';
import useTheme from '../../hooks/useTheme';
import useBanKoniStore from '../../store/useBanKoniStore';
import { getScriptableInboxDB, scriptableInboxCountsDB, finishScriptableMessageDB, hasSmsImportReceiptDB } from '../../db/database';
import { importCompanionFile, retryCompanionInbox, exportCompanionContext, type CompanionImportResult } from '../../sms/companion/import';
import { loadImportContext } from '../../sms/automatic/processor';
import { confirmQueuedTransfer, transferSuggestion } from '../../sms/automatic/transfers';
import type { ImportContext } from '../../sms/automatic/plan';
import type { InboxRow } from '../../sms/companion/schema';

export default function ScriptableSmsImport() {
    const colors=useTheme();
    const [rows,setRows]=useState<InboxRow[]>([]),[counts,setCounts]=useState<Record<string,number>>({});
    const [context,setContext]=useState<ImportContext|null>(null),[selected,setSelected]=useState<InboxRow|undefined>();
    const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
    const [limit,setLimit]=useState(50);
    const text={color:colors.textPrimary,fontSize:14,lineHeight:21};
    const muted={color:colors.textSecondary,fontSize:12,lineHeight:18};
    async function refresh() {
        const [next,stats,ctx]=await Promise.all([getScriptableInboxDB(limit),scriptableInboxCountsDB(),loadImportContext()]);
        setRows(next);setCounts(stats);setContext(ctx);
    }
    useEffect(()=>{void refresh().catch(()=>setMessage('Could not load the companion inbox. Retry when storage is available.'));},[limit]);
    async function run(action:()=>Promise<void>) {
        if(busy)return;setBusy(true);setMessage('');
        try{await action();await refresh();await useBanKoniStore.getState().loadAllData();}
        catch{setMessage('Could not finish. Existing queued messages and committed receipts are preserved. Check free space and retry.');}
        finally{setBusy(false);}
    }
    function report(result:CompanionImportResult) {
        setMessage(`Imported ${result.imported} messages · Duplicates ${result.duplicate} · Review ${result.review} · Failed ${result.failed} · Skipped ${result.skipped} · Invalid ${result.invalid.length}${result.invalid.length?'\n'+result.invalid.slice(0,5).map(e=>`Row ${e.index+1}: ${e.reason}`).join('\n'):''}`);
    }
    async function pickExport() {
        const picked=await DocumentPicker.getDocumentAsync({type:['application/json','text/json'],copyToCacheDirectory:true});
        if(picked.canceled)return;
        const file=picked.assets[0];
        try{
            const info=await FileSystem.getInfoAsync(file.uri);
            const size=file.size??(info.exists?info.size:undefined);
            if(size==null||size>5*1024*1024){setMessage('Choose a BanKoni companion export smaller than 5 MB with a readable file size.');return;}
            const raw=await FileSystem.readAsStringAsync(file.uri);
            try{report(await importCompanionFile(raw));}catch(error){setMessage(error instanceof Error?error.message:'Invalid companion export');}
        }finally{
            if(FileSystem.cacheDirectory&&file.uri.startsWith(FileSystem.cacheDirectory))await FileSystem.deleteAsync(file.uri,{idempotent:true});
        }
    }
    async function shareContext() {
        if(!FileSystem.cacheDirectory)throw Error('Local cache unavailable');
        const file=FileSystem.cacheDirectory+'BanKoni-context-v1.json';
        try{
            await FileSystem.writeAsStringAsync(file,await exportCompanionContext());
            if(!await Sharing.isAvailableAsync())throw Error('Sharing unavailable');
            await Sharing.shareAsync(file,{mimeType:'application/json',dialogTitle:'Save BanKoni account context to Files'});
            setMessage('In Scriptable’s BanKoni dashboard, choose Import account context and select the saved JSON. It contains wallet identifiers and account endings; keep it private.');
        }finally{await FileSystem.deleteAsync(file,{idempotent:true});}
    }
    const suggestions=context?rows.flatMap(debit=>rows.flatMap(credit=>{
        if(debit.id===credit.id||!debit.receivedAt||!credit.receivedAt)return[];
        const match=transferSuggestion(debit,credit,context);return match&&match.from.currency==='ETB'&&match.to.currency==='ETB'?[{debit,credit,match}]:[];
    })).slice(0,10):[];
    return <View style={{gap:12}}>
        <Text style={text}>iPhone SMS companion: Scriptable + Shortcuts</Text>
        <Text style={muted}>Install Scriptable from the App Store, add the generated BanKoni.js script, and enable iCloud Drive for Scriptable. The companion stores financial SMS evidence in your iCloud Drive, outside this app’s PIN protection. Keep your Apple account and device protected.</Text>
        <Text style={muted}>Create “BanKoni - Incoming SMS” with a Message automation → Dictionary (version 1, mode incoming_message, message containing body, sender, receivedAt) → Scriptable Run Script “BanKoni”. Set Run Immediately where available. No native BanKoni SMS action or custom IPA is required.</Text>
        <Text style={muted}>For history on iOS 26+, use Messages → Find Message where available. Pass dated messages in batches of at most 200 (50 recommended) using mode history_import. Scriptable cannot read your inbox directly. Full action-by-action setup is included with BanKoni.js in scriptable/README.md.</Text>
        <TouchableOpacity accessibilityRole="button" onPress={()=>void Linking.openURL('scriptable://').catch(()=>setMessage('Install Scriptable from the Apple App Store first.'))}><Text style={{...text,color:colors.champagne}}>Open Scriptable</Text></TouchableOpacity>
        <PrimaryButton label="Export account context for Scriptable" disabled={busy} onPress={()=>void run(shareContext)}/>
        <Text style={muted}>Export candidates from the Scriptable dashboard, then choose the JSON below. BanKoni reparses the original evidence, matches its current wallets, and checks durable receipts before insertion. Exported does not mean imported.</Text>
        <PrimaryButton label={busy?'Processing companion file…':'Import Scriptable transaction export'} disabled={busy} onPress={()=>void run(pickExport)}/>
        <PrimaryButton label="Resume pending / retry review and failed" disabled={busy} onPress={()=>void run(async()=>report(await retryCompanionInbox()))}/>
        <Text style={text}>Pending {counts.pending||0} · Imported {counts.imported||0} · Duplicates {counts.duplicate||0}{'\n'}Review {counts.review||0} · Failed {counts.failed||0} · Dismissed {counts.dismissed||0}</Text>
        {!!message&&<Text accessibilityRole="alert" style={muted}>{message}</Text>}
        {suggestions.map(({debit,credit,match})=><TouchableOpacity accessibilityRole="button" disabled={busy} key={debit.id+credit.id} onPress={()=>Alert.alert('Confirm own-account transfer',`${match.from.name} → ${match.to.name}\nETB ${(match.principal/100).toFixed(2)} + fees ${(match.fees/100).toFixed(2)}\nTotal debit ETB ${((match.principal+match.fees)/100).toFixed(2)}\n\n${debit.body}\n\n${credit.body}\n\nConfirm only if both describe the same transfer.`,[
            {text:'Cancel',style:'cancel'},{text:'Confirm transfer',onPress:()=>void run(async()=>{
                const current=await loadImportContext();
                await confirmQueuedTransfer(debit,credit,{...current,wallets:current.wallets.filter(w=>w.currency==='ETB')});
                await finishScriptableMessageDB(debit.id,'imported','Confirmed own-account transfer');
                await finishScriptableMessageDB(credit.id,'imported','Confirmed own-account transfer');
            })},
        ])}><Text style={{...text,color:colors.champagne}}>Suggested transfer: {match.from.name} → {match.to.name}</Text></TouchableOpacity>)}
        {rows.map(row=><View key={row.id} style={{gap:5,paddingVertical:8}}>
            <Text style={text}>{row.sender||'Financial message'} · {row.status}</Text><Text style={muted}>{row.reason}</Text><Text style={muted} numberOfLines={2}>{row.body}</Text>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void run(async()=>report(await retryCompanionInbox([row.id])))}><Text style={{color:colors.champagne}}>Retry this message</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>{
                if(!row.receivedAt)Alert.alert('Check the transaction date','This message has no valid original timestamp. Verify the date in the existing import review before saving.');
                setSelected(row);
            }}><Text style={{color:colors.champagne}}>Review in SMS import</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void run(()=>finishScriptableMessageDB(row.id,'dismissed','Dismissed by user'))}><Text style={muted}>Dismiss and remove app message text</Text></TouchableOpacity>
        </View>)}
        {!rows.length&&<Text style={muted}>No companion messages require review.</Text>}
        {rows.length>=limit&&limit<10000&&<PrimaryButton label="Show more queued messages" disabled={busy} onPress={()=>setLimit(value=>value+50)}/>}
        <SmsImportModal visible={!!selected} initialMessage={selected} onClose={()=>{
            const row=selected;setSelected(undefined);
            void run(async()=>{if(row&&await hasSmsImportReceiptDB(row.id))await finishScriptableMessageDB(row.id,'imported','Saved from existing review');});
        }}/>
    </View>;
}
