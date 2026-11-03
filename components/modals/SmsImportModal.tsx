// components/modals/SmsImportModal.tsx
//
// BanKoni — User-controlled SMS Transaction Import Modal.
// Workflow: Paste SMS -> Parse Locally -> Review Candidate -> Match Wallet & Category -> Import.
// Zero network transmission, zero inbox sniffing, strict local privacy.

import { useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
} from 'react-native';
import {
    AlertTriangle,
    ShieldCheck,
    Trash2,
    ArrowDownLeft,
    ArrowUpRight,
    Building2,
    Calendar,
    CheckCircle2,
    Sparkles,
    GraduationCap,
    Store,
    Receipt,
    Users,
    Check,
    ArrowLeftRight,
    Wifi,
} from 'lucide-react-native';

import ModalShell from '../common/overlays/ModalShell';
import ModalHeader from '../common/overlays/ModalHeader';
import CategoryPicker from '../common/selectors/CategoryPicker';
import WalletPicker from '../common/selectors/WalletPicker';
import PrimaryButton from '../common/buttons/PrimaryButton';
import WalletLogo from '../wallets/WalletLogo';

import useBanKoniStore from '../../store/useBanKoniStore';
import useTheme from '../../hooks/useTheme';
import { formatEtb } from '../../utils/format';
import { checkSmsDuplicateDB } from '../../db/database';

import {
    parseSms,
    matchWalletForCandidate,
    generateSmsFingerprint,
    type SmsProviderId,
    type ParsedTransactionCandidate,
    type WalletMatchOutcome,
} from '../../sms';
import * as Crypto from 'expo-crypto';
import {
    recognizeMerchant,
    type MerchantRecognitionResult,
} from '../../utils/merchantRecognizer';
import {
    recognizeEducationPayment,
    normalizeInstitutionName,
    type EducationRecognitionResult,
} from '../../utils/educationRecognizer';
import {
    classifyBillEvidence,
    correlateBillConfirmation,
    type BillerConfirmationEvidence,
    type BillCorrelationResult,
} from '../../sms/billCorrelator';
import {
    parseTelecomPackageSms,
    type TelecomParseResult,
} from '../../sms/telecomPackage';
import { correlateTransfer } from '../../sms/transferCorrelator';
import { detectProviderFromText, maskAccountIdentifier } from '../../utils/accountRegistry';
import type {
    EducationFrequency,
    EducationFeeType,
    TransferCorrelationResult,
    KnownAccount,
} from '../../types/FinancialRelationships';

interface SmsImportModalProps {
    visible: boolean;
    onClose: () => void;
    initialMessage?: { id?: string; body: string; sender: string; receivedAt: number };
}

const PROVIDER_OPTIONS: Array<{ id: SmsProviderId | 'auto'; label: string }> = [
    { id: 'auto', label: 'Auto' },
    { id: 'cbe', label: 'CBE' },
    { id: 'dashen', label: 'Dashen' },
    { id: 'telebirr', label: 'Telebirr' },
    { id: 'mpesa', label: 'M-PESA' },
    { id: 'awash', label: 'Awash' },
    { id: 'boa', label: 'BOA' },
    { id: 'cbe_birr', label: 'CBE Birr' },
];

export default function SmsImportModal({ visible, onClose, initialMessage }: SmsImportModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Zustand store
    const wallets = useBanKoniStore((state) => state.wallets);
    const categories = useBanKoniStore((state) => state.categories);
    const transactions = useBanKoniStore((state) => state.transactions);
    const merchants = useBanKoniStore((state) => state.merchants);
    const merchantRules = useBanKoniStore((state) => state.merchantRules);
    const educationInstitutions = useBanKoniStore((state) => state.educationInstitutions);
    const addTransaction = useBanKoniStore((state) => state.addTransaction);
    const saveMerchant = useBanKoniStore((state) => state.saveMerchant);
    const saveMerchantRule = useBanKoniStore((state) => state.saveMerchantRule);
    const saveEducationInstitution = useBanKoniStore((state) => state.saveEducationInstitution);
    const insertBillConfirmation = useBanKoniStore((state) => state.insertBillConfirmation);
    const linkBillConfirmation = useBanKoniStore((state) => state.linkBillConfirmation);
    const insertTelecomEvent = useBanKoniStore((state) => state.insertTelecomEvent);
    const saveTelecomPackage = useBanKoniStore((state) => state.saveTelecomPackage);
    const createSharedExpense = useBanKoniStore((state) => state.createSharedExpense);
    const knownAccounts = useBanKoniStore((state) => state.knownAccounts);
    const createTransfer = useBanKoniStore((state) => state.createTransfer);
    const completeTransferLeg = useBanKoniStore((state) => state.completeTransferLeg);
    const saveKnownAccount = useBanKoniStore((state) => state.saveKnownAccount);

    // Workflow state
    const [step, setStep] = useState<'input' | 'review' | 'telecom_event' | 'bill_confirmation'>('input');
    const [rawText, setRawText] = useState('');
    const [providerSelection, setProviderSelection] = useState<SmsProviderId | 'auto'>('auto');

    // Parse result state
    const [candidate, setCandidate] = useState<ParsedTransactionCandidate | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);

    // Review & reconciliation state
    const [walletMatch, setWalletMatch] = useState<WalletMatchOutcome | null>(null);
    const [selectedWalletId, setSelectedWalletId] = useState<string>('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
    const [confirmedDate, setConfirmedDate] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [reviewedAmount, setReviewedAmount] = useState<string>('');

    // Transfer Correlation state
    const [transferCorrelation, setTransferCorrelation] = useState<TransferCorrelationResult | null>(null);
    const [transferSourceWalletId, setTransferSourceWalletId] = useState<string>('');
    const [transferDestWalletId, setTransferDestWalletId] = useState<string>('');
    const [saveNewAccount, setSaveNewAccount] = useState<boolean>(false);

    // Deduplication & submission state
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const [isDuplicate, setIsDuplicate] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Priority Feature E: Telecom Event & Purchase state
    const [telecomEventCandidate, setTelecomEventCandidate] = useState<TelecomParseResult | null>(null);
    const [telecomPurchaseData, setTelecomPurchaseData] = useState<TelecomParseResult | null>(null);

    // Priority Feature D: Biller Confirmation state
    const [billConfirmationCandidate, setBillConfirmationCandidate] = useState<{
        evidence: BillerConfirmationEvidence;
        correlation: BillCorrelationResult;
    } | null>(null);

    // Priority Feature A: Education Recognition state
    const [isEducation, setIsEducation] = useState(false);
    const [eduInstitutionName, setEduInstitutionName] = useState('');
    const [eduFrequency, setEduFrequency] = useState<EducationFrequency>('Semester');
    const [eduFeeType, setEduFeeType] = useState<EducationFeeType>('Tuition');
    const [eduRemember, setEduRemember] = useState(true);

    // Priority Feature B: Merchant Recognition state
    const [isMerchant, setIsMerchant] = useState(false);
    const [merchantData, setMerchantData] = useState<MerchantRecognitionResult | null>(null);
    const [merchantRememberRule, setMerchantRememberRule] = useState(false);

    // Priority Feature C: Shared Expense & Bill Splitting state
    const [isSplitExpense, setIsSplitExpense] = useState(false);
    const [personalShare, setPersonalShare] = useState('');
    const [participants, setParticipants] = useState<Array<{ name: string; amount: string }>>([
        { name: '', amount: '' },
    ]);

    // Reset when modal opens or closes
    useEffect(() => {
        if (visible) {
            setStep('input');
            setRawText(initialMessage?.body || '');
            setCandidate(null);
            setParseError(null);
            setDuplicateWarning(null);
            setIsDuplicate(false);
            setProviderSelection('auto');
            setSelectedWalletId('');
            setSelectedCategoryId('');
            setNote('');
            setReviewedAmount('');
            setTelecomEventCandidate(null);
            setTelecomPurchaseData(null);
            setBillConfirmationCandidate(null);
            setIsEducation(false);
            setEduInstitutionName('');
            setEduFrequency('Semester');
            setEduFeeType('Tuition');
            setEduRemember(true);
            setIsMerchant(false);
            setMerchantData(null);
            setMerchantRememberRule(false);
            setIsSplitExpense(false);
            setPersonalShare('');
            setParticipants([{ name: '', amount: '' }]);
            setTransferCorrelation(null);
            setTransferSourceWalletId('');
            setTransferDestWalletId('');
            setSaveNewAccount(false);
        }
    }, [visible]);

    // Handle parsing the pasted text
    const handleParse = async () => {
        setParseError(null);
        if (!rawText.trim()) {
            setParseError('Please paste an SMS transaction message first.');
            return;
        }

        // 1. Check for Telecom Service Event (Alert, Depletion, Expiry, Activation without price)
        const telecomRes = parseTelecomPackageSms(rawText);
        if (
            telecomRes.isTelecomPackage &&
            (!telecomRes.isFinancialDebit || telecomRes.price == null || telecomRes.price <= 0)
        ) {
            setTelecomEventCandidate(telecomRes);
            setStep('telecom_event');
            return;
        }

        // 2. Check for Biller Confirmation Evidence (e.g. Ethio Telecom bill receipt for ETB 1,874.99)
        const billEvidence = classifyBillEvidence(rawText);
        if (billEvidence.type === 'biller_confirmation' && billEvidence.evidence) {
            const correlation = correlateBillConfirmation(billEvidence.evidence, transactions);
            setBillConfirmationCandidate({
                evidence: billEvidence.evidence,
                correlation,
            });
            setStep('bill_confirmation');
            return;
        }

        // 3. Parse Standard Financial SMS Candidate
        const result = parseSms(rawText, providerSelection, initialMessage?.sender);

        if (result.status === 'parsed') {
            const parsedCandidate = result.candidate;
            setCandidate(parsedCandidate);

            // A. Match wallet using provider and account identifiers
            const match = matchWalletForCandidate(parsedCandidate, wallets);
            setWalletMatch(match);
            if (match.matchedWallet) {
                setSelectedWalletId(match.matchedWallet.id);
            } else {
                setSelectedWalletId('');
            }

            // A2. Dedicated Own-Account & Inter-Account Transfer Detection
            const transferCorr = correlateTransfer(parsedCandidate, rawText, {
                existingTransactions: transactions,
                wallets,
                knownAccounts,
            });
            setTransferCorrelation(transferCorr);

            if (transferCorr.status === 'OWN_ACCOUNT_MATCHED' || transferCorr.status === 'OWN_ACCOUNT_CANDIDATE') {
                if (transferCorr.sourceWalletId) setTransferSourceWalletId(transferCorr.sourceWalletId);
                if (transferCorr.destinationWalletId) setTransferDestWalletId(transferCorr.destinationWalletId);
                if (match.matchedWallet) {
                    if (parsedCandidate.type === 'DEBIT') {
                        setTransferSourceWalletId(match.matchedWallet.id);
                    } else {
                        setTransferDestWalletId(match.matchedWallet.id);
                    }
                }
            }

            // B. Set default date
            const initialDate = parsedCandidate.dateTime || new Date(initialMessage?.receivedAt || Date.now()).toISOString();
            setConfirmedDate(initialDate);

            // C. Set pre-filled note and initial reviewed amount
            setNote(parsedCandidate.description || 'SMS Transaction');
            setReviewedAmount(parsedCandidate.ledgerAmount > 0 ? parsedCandidate.ledgerAmount.toString() : '');

            // D. Duplicate pre-check
            const candidateForFp = {
                ...parsedCandidate,
                dateTime: parsedCandidate.dateTime || initialDate,
            };
            const fingerprint = generateSmsFingerprint(candidateForFp);
            const dupCheck = await checkSmsDuplicateDB(parsedCandidate.reference, fingerprint, match.matchedWallet?.id, parsedCandidate.type);

            if (dupCheck.isDuplicate) {
                setIsDuplicate(true);
                if (dupCheck.matchedBy === 'reference') {
                    setDuplicateWarning(`A transaction with reference "${parsedCandidate.reference}" is already in your database.`);
                } else {
                    setDuplicateWarning('An identical transaction fingerprint was found in your vault.');
                }
            } else {
                setIsDuplicate(false);
                setDuplicateWarning(null);
            }

            // E. Priority Feature A: Education Payment Recognition
            const eduResult = recognizeEducationPayment(rawText, parsedCandidate.counterparty, educationInstitutions);
            let assignedCategoryId = '';

            if (eduResult.isEducation) {
                setIsEducation(true);
                setEduInstitutionName(eduResult.institutionName);
                setEduFrequency(eduResult.frequency);
                setEduFeeType(eduResult.feeType);
                setEduRemember(!eduResult.isRemembered);

                const eduCat = categories.find((c) => c.flow === 'EXPENSE' && /education|school|tuition|books/i.test(c.name))
                    || categories.find((c) => c.id === 'cat-5');
                if (eduCat) {
                    assignedCategoryId = eduCat.id;
                }
            } else {
                setIsEducation(false);
            }

            // F. Priority Feature B: Merchant Recognition (for DEBIT)
            if (parsedCandidate.type === 'DEBIT' && !eduResult.isEducation) {
                const merchResult = recognizeMerchant(
                    parsedCandidate.counterparty || parsedCandidate.description || rawText,
                    merchantRules,
                    merchants
                );
                if (merchResult.isMerchant) {
                    setIsMerchant(true);
                    setMerchantData(merchResult);
                    setMerchantRememberRule(false);
                    if (merchResult.suggestedCategoryId) {
                        assignedCategoryId = merchResult.suggestedCategoryId;
                    }
                } else {
                    setIsMerchant(false);
                    setMerchantData(null);
                }
            } else if (eduResult.isEducation) {
                setIsMerchant(false);
                setMerchantData(null);
            }

            // G. Priority Feature E: Telecom Package Purchase (with Debit)
            if (telecomRes.isTelecomPackage && telecomRes.isFinancialDebit && telecomRes.price && telecomRes.price > 0) {
                setTelecomPurchaseData(telecomRes);
                const telecomCat = categories.find(
                    (c) => c.flow === 'EXPENSE' && /internet|package|bundle|telecom|wifi/i.test(c.name)
                ) || categories.find((c) => c.id === 'cat-6');
                if (telecomCat) {
                    assignedCategoryId = telecomCat.id;
                }
            } else {
                setTelecomPurchaseData(null);
            }

            // H. Fallback category for internet package if not yet assigned
            if (!assignedCategoryId) {
                const isInternetPackage =
                    /internet\s+package|daily\s+internet|monthly\s+internet|unlimited\s+internet|data\s+package|safaricom\s+bundle|\bbundle\b/i.test(
                        (parsedCandidate.description || '') + ' ' + rawText
                    );

                if (isInternetPackage && parsedCandidate.type === 'DEBIT') {
                    const netCat = categories.find(
                        (c) => c.flow === 'EXPENSE' && /internet|package|bundle|telecom|wifi/i.test(c.name)
                    );
                    if (netCat) {
                        assignedCategoryId = netCat.id;
                    }
                }
            }

            setSelectedCategoryId(assignedCategoryId);
            setStep('review');
        } else if (result.status === 'non_transaction') {
            setParseError(`Non-ledger message detected: ${result.reason}`);
        } else if (result.status === 'unsupported_provider') {
            setParseError(result.reason);
        } else if (result.status === 'malformed') {
            setParseError(`Message format error: ${result.reason}`);
        } else {
            setParseError(`Could not parse: ${result.reason}`);
        }
    };

    // Filter categories strictly by transaction flow
    const flowCategories = categories.filter((cat) => {
        if (!candidate) return false;
        return candidate.type === 'DEBIT' ? cat.flow === 'EXPENSE' : cat.flow === 'INCOME';
    });

    // Save Telecom Service Event
    const handleSaveTelecomEvent = async () => {
        if (!telecomEventCandidate) return;
        setIsSaving(true);
        try {
            let pkgId: string | undefined;
            if (telecomEventCandidate.packageName) {
                const newPkgId = Crypto.randomUUID();
                const savedPkg = await saveTelecomPackage({
                    id: newPkgId,
                    packageName: telecomEventCandidate.packageName,
                    category: 'combo',
                    isActive: telecomEventCandidate.eventType !== 'DEPLETION' && telecomEventCandidate.eventType !== 'EXPIRY',
                });
                pkgId = savedPkg.id;
            }

            await insertTelecomEvent({
                id: Crypto.randomUUID(),
                packageInstanceId: pkgId,
                packageName: telecomEventCandidate.packageName || 'Telecom Event',
                eventType: telecomEventCandidate.eventType || 'ACTIVATION',
                eventTime: new Date().toISOString(),
                volumeText: telecomEventCandidate.volumeText,
                usagePercentage: telecomEventCandidate.usagePercentage,
                expiryTime: telecomEventCandidate.expiryTime,
                rawSms: telecomEventCandidate.rawText,
            });

            Alert.alert(
                'Service Event Recorded',
                `Logged ${telecomEventCandidate.packageName || 'Telecom Event'} (${telecomEventCandidate.eventType}). No financial debit was added to your ledger.`,
                [{ text: 'OK', onPress: onClose }]
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Could not save telecom event.';
            Alert.alert('Save Failed', msg);
        } finally {
            setIsSaving(false);
        }
    };

    // Link Biller Confirmation to Existing Debit
    const handleLinkBillConfirmation = async (matchedTxId: string) => {
        if (!billConfirmationCandidate) return;
        setIsSaving(true);
        try {
            const { evidence } = billConfirmationCandidate;
            const confirmation = await insertBillConfirmation({
                id: Crypto.randomUUID(),
                billerName: evidence.billerName,
                accountNumber: evidence.accountNumber,
                billReference: evidence.billReference,
                confirmationCode: evidence.confirmationCode,
                amount: evidence.amount,
                status: 'MATCHED',
                matchedTransactionId: matchedTxId,
                rawMessage: evidence.rawMessage,
                messageDate: evidence.messageDate || new Date().toISOString(),
            });

            await linkBillConfirmation(confirmation.id, matchedTxId);

            Alert.alert(
                'Receipt Correlated & Linked',
                `Linked ${evidence.billerName} confirmation of ${formatEtb(evidence.amount)} to your existing transaction. No duplicate expense recorded.`,
                [{ text: 'OK', onPress: onClose }]
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Could not link confirmation.';
            Alert.alert('Link Failed', msg);
        } finally {
            setIsSaving(false);
        }
    };

    // Save Biller Confirmation Only (No debit)
    const handleSaveBillConfirmationOnly = async () => {
        if (!billConfirmationCandidate) return;
        setIsSaving(true);
        try {
            const { evidence } = billConfirmationCandidate;
            await insertBillConfirmation({
                id: Crypto.randomUUID(),
                billerName: evidence.billerName,
                accountNumber: evidence.accountNumber,
                billReference: evidence.billReference,
                confirmationCode: evidence.confirmationCode,
                amount: evidence.amount,
                status: 'UNMATCHED',
                rawMessage: evidence.rawMessage,
                messageDate: evidence.messageDate || new Date().toISOString(),
            });

            Alert.alert(
                'Biller Confirmation Saved',
                `Stored ${evidence.billerName} receipt of ${formatEtb(evidence.amount)} in evidence records. No duplicate financial expense created.`,
                [{ text: 'OK', onPress: onClose }]
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Could not save confirmation.';
            Alert.alert('Save Failed', msg);
        } finally {
            setIsSaving(false);
        }
    };

    // Confirm Own-Account Transfer (Matched or Candidate)
    const handleConfirmTransfer = async () => {
        if (!candidate || !transferCorrelation) return;
        if (initialMessage?.id) {
            Alert.alert('Confirm both transfer messages', 'Use the suggested transfer in Automatic SMS Import to confirm both messages together, including their fees. Keep this message for review until the other leg is available.');
            return;
        }
        setIsSaving(true);
        try {
            if (transferCorrelation.status === 'OWN_ACCOUNT_MATCHED') {
                const targetWId = selectedWalletId || (candidate.type === 'CREDIT' ? transferDestWalletId : transferSourceWalletId);
                if (!targetWId) {
                    Alert.alert('Account Required', 'Please select a wallet to record this transfer leg.');
                    setIsSaving(false);
                    return;
                }

                await completeTransferLeg({
                    existingTransactionId: transferCorrelation.matchedTransactionId!,
                    newLeg: {
                        walletId: targetWId,
                        type: candidate.type,
                        amount: transferCorrelation.principalAmount,
                        feeAmount: transferCorrelation.feeAmount > 0 ? transferCorrelation.feeAmount : undefined,
                        smsReference: candidate.reference,
                        rawSms: rawText,
                        currentBalance: candidate.currentBalance,
                        date: confirmedDate || candidate.dateTime,
                        note: note.trim() || undefined,
                    },
                    note: note.trim() || undefined,
                });

                Alert.alert(
                    'Own-Account Transfer Linked',
                    `Linked transfer between your accounts. Principal: ${formatEtb(transferCorrelation.principalAmount)}, Transfer fees: ${formatEtb(transferCorrelation.feeAmount)}. Source debit: ${formatEtb(transferCorrelation.totalDebitAmount)}, Destination credit: ${formatEtb(transferCorrelation.destinationCreditAmount)}. No duplicate records created.`,
                    [{ text: 'OK', onPress: onClose }]
                );
            } else if (transferCorrelation.status === 'OWN_ACCOUNT_CANDIDATE') {
                const fromWId = transferSourceWalletId || (candidate.type === 'DEBIT' ? selectedWalletId : '');
                const toWId = transferDestWalletId || (candidate.type === 'CREDIT' ? selectedWalletId : '');

                if (fromWId && toWId && fromWId !== toWId) {
                    await createTransfer({
                        fromWalletId: fromWId,
                        toWalletId: toWId,
                        amount: transferCorrelation.principalAmount,
                        feeAmount: transferCorrelation.feeAmount > 0 ? transferCorrelation.feeAmount : undefined,
                        note: note.trim() || undefined,
                        date: confirmedDate || candidate.dateTime,
                        fromSmsReference: candidate.type === 'DEBIT' ? candidate.reference : undefined,
                        toSmsReference: candidate.type === 'CREDIT' ? candidate.reference : undefined,
                        fromRawSms: candidate.type === 'DEBIT' ? rawText : undefined,
                        toRawSms: candidate.type === 'CREDIT' ? rawText : undefined,
                        reconciledFromBalance: candidate.type === 'DEBIT' ? candidate.currentBalance : undefined,
                        reconciledToBalance: candidate.type === 'CREDIT' ? candidate.currentBalance : undefined,
                        source: 'sms',
                    });

                    if (saveNewAccount && candidate.accountIdentifier) {
                        const newAcctId = `ka-${Date.now()}`;
                        await saveKnownAccount({
                            id: newAcctId,
                            providerId: candidate.providerId,
                            accountType: candidate.providerId === 'telebirr' || candidate.providerId === 'mpesa' ? 'mobile_money' : 'bank',
                            accountNumber: candidate.accountIdentifier,
                            accountLast4: candidate.accountLast4,
                            displayName: `${getProviderTitle(candidate.providerId)} (${maskAccountIdentifier(candidate.accountIdentifier)})`,
                            maskedIdentifier: maskAccountIdentifier(candidate.accountIdentifier),
                            ownership: 'OWN',
                            createdAt: new Date().toISOString(),
                        });
                    }

                    Alert.alert(
                        'Transfer Recorded',
                        `Internal transfer of ${formatEtb(transferCorrelation.principalAmount)} recorded between your accounts. Total source debit: ${formatEtb(transferCorrelation.totalDebitAmount)}, Destination credit: ${formatEtb(transferCorrelation.destinationCreditAmount)}.`,
                        [{ text: 'OK', onPress: onClose }]
                    );
                } else {
                    const legWalletId = selectedWalletId || (candidate.type === 'DEBIT' ? fromWId : toWId);
                    if (!legWalletId) {
                        Alert.alert('Account Required', 'Please select a wallet to record this transfer leg.');
                        setIsSaving(false);
                        return;
                    }

                    const newTxId = Crypto.randomUUID();
                    await addTransaction({
                        id: newTxId,
                        amount: transferCorrelation.principalAmount,
                        type: candidate.type,
                        subType: 'TRANSFER',
                        isTransfer: true,
                        feeAmount: transferCorrelation.feeAmount > 0 ? transferCorrelation.feeAmount : undefined,
                        categoryId: candidate.type === 'DEBIT' ? 'cat-1' : 'cat-10',
                        walletId: legWalletId,
                        note: note.trim() || `Own-account transfer (${candidate.type === 'DEBIT' ? 'debit' : 'credit'} leg)`,
                        date: confirmedDate || candidate.dateTime || new Date().toISOString(),
                        status: 'CLEARED',
                        currentBalance: candidate.currentBalance,
                        source: 'sms',
                        smsReference: candidate.reference,
                        counterparty: candidate.counterparty,
                    });

                    Alert.alert(
                        'Transfer Leg Saved',
                        `Saved ${candidate.type === 'DEBIT' ? 'debit' : 'credit'} leg of ${formatEtb(transferCorrelation.principalAmount)}. When the matching ${candidate.type === 'DEBIT' ? 'credit' : 'debit'} SMS arrives, BanKoni will automatically recognize and link them together.`,
                        [{ text: 'OK', onPress: onClose }]
                    );
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Could not process transfer.';
            Alert.alert('Transfer Error', msg);
        } finally {
            setIsSaving(false);
        }
    };

    // Handle user confirmation and database import
    const handleConfirmImport = async () => {
        if (!candidate) return;

        const parsedAmt = parseFloat(reviewedAmount.trim());
        const finalAmount = !isNaN(parsedAmt) && parsedAmt > 0 ? parsedAmt : candidate.ledgerAmount;

        if (!finalAmount || finalAmount <= 0) {
            Alert.alert('Amount Required', 'Please enter a valid transaction amount.');
            return;
        }

        if (!selectedWalletId) {
            Alert.alert('Wallet Required', 'Please select a wallet to record this transaction.');
            return;
        }

        if (!selectedCategoryId) {
            Alert.alert('Category Required', 'Please select a category for this transaction.');
            return;
        }

        if (isSplitExpense) {
            const pShare = parseFloat(personalShare.trim());
            if (isNaN(pShare) || pShare < 0 || pShare > finalAmount) {
                Alert.alert('Invalid Share', 'Please enter a valid personal share amount (between 0 and the total amount).');
                return;
            }

            const validParticipants = participants.filter((p) => p.name.trim() && parseFloat(p.amount) > 0);
            if (validParticipants.length === 0) {
                Alert.alert('Participants Required', 'Please add at least one participant with an amount owed.');
                return;
            }

            const sumParticipants = validParticipants.reduce((sum, p) => sum + parseFloat(p.amount), 0);
            const totalAllocated = Number((pShare + sumParticipants).toFixed(2));
            if (Math.abs(totalAllocated - finalAmount) > 0.05) {
                Alert.alert(
                    'Split Mismatch',
                    `Your share (${formatEtb(pShare)}) plus others' shares (${formatEtb(sumParticipants)}) equals ${formatEtb(totalAllocated)}, which does not match total amount ${formatEtb(finalAmount)}.`
                );
                return;
            }
        }

        if (isDuplicate) {
            Alert.alert(
                'Possible Duplicate',
                'This transaction appears to already exist in your records. Importing it again may cause double-counting. Proceed anyway?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Import Anyway', style: 'destructive', onPress: executeImport },
                ]
            );
            return;
        }

        await executeImport();
    };

    const executeImport = async (confirmedOrdinary = false) => {
        if (!candidate) return;
        if (initialMessage?.id && transferCorrelation?.isOwnAccountTransfer && !confirmedOrdinary) {
            Alert.alert('Check the transaction type', 'This message may describe a transfer between your own accounts. Confirm both messages in Automatic SMS Import for a transfer. Continue here only if you know this is a personal expense or genuine income.', [
                { text: 'Keep for transfer review', style: 'cancel' },
                { text: candidate.type === 'DEBIT' ? 'Record as expense' : 'Record as income', onPress: () => void executeImport(true) },
            ]);
            return;
        }

        const parsedAmt = parseFloat(reviewedAmount.trim());
        const finalAmount = !isNaN(parsedAmt) && parsedAmt > 0 ? parsedAmt : candidate.ledgerAmount;

        if (!finalAmount || finalAmount <= 0) {
            Alert.alert('Amount Required', 'Please enter a valid transaction amount.');
            return;
        }

        setIsSaving(true);
        try {
            let subType: import('../../types/FinancialRelationships').TransactionSubType = 'STANDARD';
            let counterparty = candidate.counterparty;
            let merchantId: string | undefined;
            let educationInstitutionId: string | undefined;

            if (isSplitExpense && candidate.type === 'DEBIT') {
                subType = 'SHARED_EXPENSE';
            }

            // 1. Handle Education details & persistence
            if (isEducation) {
                counterparty = eduInstitutionName.trim() || counterparty;
                if (eduRemember && eduInstitutionName.trim()) {
                    const instId = Crypto.randomUUID();
                    const savedInst = await saveEducationInstitution({
                        id: instId,
                        name: eduInstitutionName.trim(),
                        normalizedName: normalizeInstitutionName(eduInstitutionName.trim()),
                        preferredFrequency: eduFrequency,
                        preferredFeeType: eduFeeType,
                        defaultCategoryId: selectedCategoryId,
                    });
                    educationInstitutionId = savedInst.id;
                }
            } else if (isMerchant && merchantData) {
                counterparty = merchantData.merchantName;
                const mId = Crypto.randomUUID();
                const savedM = await saveMerchant({
                    id: mId,
                    name: merchantData.merchantName,
                    normalizedName: merchantData.normalizedName,
                    merchantType: merchantData.merchantType,
                    defaultCategoryId: selectedCategoryId,
                });
                merchantId = savedM.id;

                if (merchantRememberRule) {
                    await saveMerchantRule({
                        id: Crypto.randomUUID(),
                        merchantId: savedM.id,
                        categoryId: selectedCategoryId,
                        pattern: merchantData.normalizedName,
                        autoApply: true,
                    });
                }
            }

            const newTxId = Crypto.randomUUID();
            const candidateForFp = {
                ...candidate,
                ledgerAmount: finalAmount,
                principalAmount: finalAmount,
                dateTime: confirmedDate || candidate.dateTime,
            };
            const fingerprint = generateSmsFingerprint(candidateForFp);

            await addTransaction({
                id: newTxId,
                amount: finalAmount,
                type: candidate.type,
                categoryId: selectedCategoryId,
                walletId: selectedWalletId,
                note: note.trim() || candidate.description,
                date: confirmedDate,
                status: 'CLEARED',
                currentBalance: candidate.currentBalance,
                source: 'sms',
                smsReference: candidate.reference,
                smsFingerprint: fingerprint,
                subType,
                counterparty,
                merchantId,
                educationInstitutionId,
            }, initialMessage?.id);

            // 2. Link Telecom Package & Event if purchase
            if (telecomPurchaseData) {
                const pkgId = Crypto.randomUUID();
                const pkg = await saveTelecomPackage({
                    id: pkgId,
                    packageName: telecomPurchaseData.packageName || 'Monthly Telecom Package',
                    category: 'combo',
                    isActive: true,
                });
                await insertTelecomEvent({
                    id: Crypto.randomUUID(),
                    packageInstanceId: pkg.id,
                    packageName: telecomPurchaseData.packageName || 'Monthly Telecom Package',
                    eventType: 'PURCHASE',
                    price: finalAmount,
                    volumeText: telecomPurchaseData.volumeText,
                    transactionId: newTxId,
                    eventTime: confirmedDate,
                    rawSms: rawText,
                });
            }

            // 3. Create Shared Expense if split enabled (Priority Feature C)
            if (isSplitExpense && candidate.type === 'DEBIT') {
                const pShare = parseFloat(personalShare.trim()) || 0;
                const validParticipants = participants
                    .filter((p) => p.name.trim() && parseFloat(p.amount) > 0)
                    .map((p) => ({
                        name: p.name.trim(),
                        expectedAmount: parseFloat(p.amount),
                    }));

                if (validParticipants.length > 0) {
                    await createSharedExpense({
                        transactionId: newTxId,
                        totalAmount: finalAmount,
                        personalShare: pShare,
                        description: note.trim() || candidate.description,
                        participants: validParticipants,
                    });
                }
            }

            // Wipe sensitive raw SMS from memory immediately
            setRawText('');
            setCandidate(null);

            Alert.alert(
                'Import Successful',
                `Saved ${candidate.type === 'DEBIT' ? 'Expense' : 'Income'} of ${formatEtb(finalAmount)} to your wallet.`,
                [{ text: 'OK', onPress: onClose }]
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Database import failed.';
            Alert.alert('Import Failed', msg);
        } finally {
            setIsSaving(false);
        }
    };

    const getProviderTitle = (id: SmsProviderId) => {
        switch (id) {
            case 'cbe':
                return 'Commercial Bank of Ethiopia';
            case 'dashen':
                return 'Dashen Bank';
            case 'telebirr':
                return 'Telebirr (Ethio telecom)';
            case 'mpesa':
                return 'M-PESA (Safaricom)';
            case 'awash':
                return 'Awash Bank';
            case 'boa':
                return 'Bank of Abyssinia (BOA)';
            case 'cbe_birr':
                return 'CBE Birr';
            default:
                return 'Unknown Provider';
        }
    };

    return (
        <ModalShell visible={visible} onRequestClose={onClose}>
            <ModalHeader
                eyebrow="LOCAL-FIRST IMPORT"
                title={
                    step === 'input'
                        ? 'Paste SMS'
                        : step === 'telecom_event'
                        ? 'Telecom Service Alert'
                        : step === 'bill_confirmation'
                        ? 'Biller Confirmation'
                        : 'Review & Import'
                }
                onClose={onClose}
            />

            <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {step === 'input' ? (
                    <View style={styles.inputContainer}>
                        <View style={styles.privacyBanner}>
                            <ShieldCheck size={18} color={colors.champagne} />
                            <Text style={styles.privacyBannerText}>
                                100% Private. Parsing runs locally on your device. Messages are never sent to external servers or logged.
                            </Text>
                        </View>

                        <Text style={styles.label}>PROVIDER</Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.providerScroll}
                            style={styles.providerScrollView}
                        >
                            {PROVIDER_OPTIONS.map((opt) => {
                                const selected = providerSelection === opt.id;
                                return (
                                    <TouchableOpacity
                                        key={opt.id}
                                        style={[styles.providerTab, selected && styles.providerTabActive]}
                                        onPress={() => setProviderSelection(opt.id)}
                                        activeOpacity={0.8}
                                    >
                                        {opt.id === 'auto' ? (
                                            <View style={[styles.providerAutoBadge, selected && styles.providerAutoBadgeActive]}>
                                                <Sparkles size={15} color={selected ? colors.champagne : colors.textSecondary} />
                                            </View>
                                        ) : (
                                            <WalletLogo providerId={opt.id} size={22} style={styles.providerLogo} />
                                        )}
                                        <Text style={[styles.providerTabText, selected && styles.providerTabTextActive]} numberOfLines={1}>
                                            {opt.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>

                        <View style={styles.smsInputHeader}>
                            <Text style={styles.label}>SMS MESSAGE TEXT</Text>
                            {rawText.length > 0 && (
                                <TouchableOpacity
                                    onPress={() => setRawText('')}
                                    style={styles.clearButton}
                                    activeOpacity={0.7}
                                >
                                    <Trash2 size={14} color={colors.textSecondary} />
                                    <Text style={styles.clearButtonText}>Clear</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <TextInput
                            style={styles.textArea}
                            placeholder="Paste the bank or Telebirr transaction SMS message here..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={5}
                            value={rawText}
                            onChangeText={setRawText}
                            textAlignVertical="top"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        {parseError && (
                            <View style={styles.errorBox}>
                                <AlertTriangle size={18} color={colors.danger} />
                                <Text style={styles.errorText}>{parseError}</Text>
                            </View>
                        )}

                        <View style={styles.buttonContainer}>
                            <PrimaryButton
                                label="Parse SMS"
                                onPress={handleParse}
                                disabled={!rawText.trim()}
                            />
                        </View>
                    </View>
                ) : step === 'telecom_event' && telecomEventCandidate ? (
                    /* ── TELECOM SERVICE EVENT VIEW (Priority Feature E) ── */
                    <View style={styles.reviewContainer}>
                        <View style={styles.summaryCard}>
                            <View style={styles.featureHeader}>
                                <Wifi size={18} color={colors.champagne} />
                                <Text style={styles.featureTitle}>TELECOM SERVICE EVENT</Text>
                            </View>

                            <View style={styles.metaRow}>
                                <Text style={styles.metaKey}>Package:</Text>
                                <Text style={styles.metaValue}>{telecomEventCandidate.packageName || 'Telecom Offer'}</Text>
                            </View>

                            <View style={styles.metaRow}>
                                <Text style={styles.metaKey}>Event Type:</Text>
                                <Text style={[styles.metaValue, { textTransform: 'capitalize', color: colors.champagne, fontWeight: '700' }]}>
                                    {telecomEventCandidate.eventType?.replace('_', ' ') || 'Notification'}
                                </Text>
                            </View>

                            {telecomEventCandidate.volumeText && (
                                <View style={styles.metaRow}>
                                    <Text style={styles.metaKey}>Volume / Quota:</Text>
                                    <Text style={styles.metaValue}>{telecomEventCandidate.volumeText}</Text>
                                </View>
                            )}

                            {telecomEventCandidate.expiryTime && (
                                <View style={styles.metaRow}>
                                    <Text style={styles.metaKey}>Expiry Date:</Text>
                                    <Text style={styles.metaValue}>{telecomEventCandidate.expiryTime}</Text>
                                </View>
                            )}

                            <View style={styles.privacyBanner}>
                                <ShieldCheck size={16} color={colors.champagne} />
                                <Text style={styles.privacyBannerText}>
                                    Service Event Only: Network usage alerts, package completions, and zero-price activations do not create financial expenses or affect your cash balance.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.reviewButtons}>
                            <TouchableOpacity
                                style={styles.backButton}
                                onPress={() => setStep('input')}
                                disabled={isSaving}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.backButtonText}>Back to Text</Text>
                            </TouchableOpacity>

                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <PrimaryButton
                                    label={isSaving ? 'Recording...' : 'Record Service Event'}
                                    onPress={handleSaveTelecomEvent}
                                    disabled={isSaving}
                                    loading={isSaving}
                                />
                            </View>
                        </View>
                    </View>
                ) : step === 'bill_confirmation' && billConfirmationCandidate ? (
                    /* ── BILLER CONFIRMATION VIEW (Priority Feature D) ── */
                    <View style={styles.reviewContainer}>
                        <View style={styles.summaryCard}>
                            <View style={styles.featureHeader}>
                                <Receipt size={18} color={colors.champagne} />
                                <Text style={styles.featureTitle}>BILLER RECEIPT CONFIRMATION</Text>
                            </View>

                            <View style={styles.metaRow}>
                                <Text style={styles.metaKey}>Biller Name:</Text>
                                <Text style={[styles.metaValue, { fontWeight: '700' }]}>
                                    {billConfirmationCandidate.evidence.billerName}
                                </Text>
                            </View>

                            <View style={styles.metaRow}>
                                <Text style={styles.metaKey}>Paid Amount:</Text>
                                <Text style={[styles.metaValue, { color: colors.champagne, fontWeight: '700', fontSize: 16 }]}>
                                    {formatEtb(billConfirmationCandidate.evidence.amount)}
                                </Text>
                            </View>

                            {billConfirmationCandidate.evidence.accountNumber && (
                                <View style={styles.metaRow}>
                                    <Text style={styles.metaKey}>Account / Service:</Text>
                                    <Text style={styles.metaValue}>{billConfirmationCandidate.evidence.accountNumber}</Text>
                                </View>
                            )}

                            {(billConfirmationCandidate.evidence.confirmationCode || billConfirmationCandidate.evidence.billReference) && (
                                <View style={styles.metaRow}>
                                    <Text style={styles.metaKey}>Receipt / Ref:</Text>
                                    <Text style={styles.metaValue}>
                                        {billConfirmationCandidate.evidence.confirmationCode || billConfirmationCandidate.evidence.billReference}
                                    </Text>
                                </View>
                            )}

                            {/* Correlation matching result */}
                            {billConfirmationCandidate.correlation.status === 'MATCHED' && billConfirmationCandidate.correlation.matchedTransaction ? (
                                <View style={[styles.walletMatchBanner, { backgroundColor: `${colors.success}12`, borderColor: `${colors.success}40` }]}>
                                    <CheckCircle2 size={16} color={colors.success} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.walletMatchText, { color: colors.success, fontWeight: '700' }]}>
                                            Correlated with Wallet Debit!
                                        </Text>
                                        <Text style={[styles.walletMatchText, { fontSize: 11, marginTop: 2 }]}>
                                            Matches {formatEtb(billConfirmationCandidate.correlation.matchedTransaction.amount)} payment on {new Date(billConfirmationCandidate.correlation.matchedTransaction.date).toLocaleDateString()}. Linking ensures you don't double count.
                                        </Text>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.walletMatchBanner}>
                                    <ShieldCheck size={16} color={colors.champagne} />
                                    <Text style={styles.walletMatchText}>
                                        Biller evidence recorded without creating an additional expense.
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.reviewButtons}>
                            <TouchableOpacity
                                style={styles.backButton}
                                onPress={() => setStep('input')}
                                disabled={isSaving}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.backButtonText}>Back to Text</Text>
                            </TouchableOpacity>

                            <View style={{ flex: 1, marginLeft: 12 }}>
                                {billConfirmationCandidate.correlation.status === 'MATCHED' && billConfirmationCandidate.correlation.matchedTransaction ? (
                                    <PrimaryButton
                                        label={isSaving ? 'Linking...' : 'Link to Debit (No Double Count)'}
                                        onPress={() => handleLinkBillConfirmation(billConfirmationCandidate.correlation.matchedTransaction!.id)}
                                        disabled={isSaving}
                                        loading={isSaving}
                                    />
                                ) : (
                                    <PrimaryButton
                                        label={isSaving ? 'Saving...' : 'Save Receipt Only'}
                                        onPress={handleSaveBillConfirmationOnly}
                                        disabled={isSaving}
                                        loading={isSaving}
                                    />
                                )}
                            </View>
                        </View>
                    </View>
                ) : (
                    candidate && (
                        transferCorrelation && (transferCorrelation.status === 'OWN_ACCOUNT_MATCHED' || transferCorrelation.status === 'OWN_ACCOUNT_CANDIDATE') ? (
                            <View style={styles.reviewContainer}>
                                <View style={styles.summaryCard}>
                                    <View style={styles.featureHeader}>
                                        <ArrowLeftRight size={18} color={colors.champagne} />
                                        <Text style={styles.featureTitle}>
                                            {transferCorrelation.status === 'OWN_ACCOUNT_MATCHED'
                                                ? 'OWN-ACCOUNT TRANSFER LINKED'
                                                : 'OWN-ACCOUNT TRANSFER DETECTED'}
                                        </Text>
                                    </View>

                                    <View style={[styles.walletMatchBanner, { backgroundColor: `${colors.champagne}15`, borderColor: `${colors.champagne}40` }]}>
                                        <CheckCircle2 size={16} color={colors.champagne} />
                                        <Text style={[styles.walletMatchText, { color: colors.textPrimary, fontWeight: '600' }]}>
                                            {transferCorrelation.reason}
                                        </Text>
                                    </View>

                                    {/* Transfer Breakdown */}
                                    <View style={styles.feesContainer}>
                                        <Text style={styles.feesTitle}>TRANSFER LEDGER SUMMARY</Text>
                                        <View style={styles.feeRow}>
                                            <Text style={styles.feeLabel}>Principal Amount:</Text>
                                            <Text style={[styles.feeValue, { fontWeight: '700', color: colors.champagne }]}>
                                                {formatEtb(transferCorrelation.principalAmount)}
                                            </Text>
                                        </View>
                                        <View style={styles.feeRow}>
                                            <Text style={styles.feeLabel}>Transfer Fees & Taxes:</Text>
                                            <Text style={styles.feeValue}>
                                                {formatEtb(transferCorrelation.feeAmount)}
                                            </Text>
                                        </View>
                                        <View style={styles.feeRow}>
                                            <Text style={styles.feeLabel}>Total Source Debit:</Text>
                                            <Text style={[styles.feeValue, { color: colors.danger, fontWeight: '700' }]}>
                                                -{formatEtb(transferCorrelation.totalDebitAmount)}
                                            </Text>
                                        </View>
                                        <View style={styles.feeRow}>
                                            <Text style={styles.feeLabel}>Destination Credit:</Text>
                                            <Text style={[styles.feeValue, { color: colors.success, fontWeight: '700' }]}>
                                                +{formatEtb(transferCorrelation.destinationCreditAmount)}
                                            </Text>
                                        </View>
                                        {transferCorrelation.reconciledSourceBalance !== undefined && (
                                            <View style={styles.feeRow}>
                                                <Text style={styles.feeLabel}>Source Reconciled Balance:</Text>
                                                <Text style={styles.feeValue}>{formatEtb(transferCorrelation.reconciledSourceBalance)}</Text>
                                            </View>
                                        )}
                                        {transferCorrelation.reconciledDestinationBalance !== undefined && (
                                            <View style={styles.feeRow}>
                                                <Text style={styles.feeLabel}>Destination Reconciled Balance:</Text>
                                                <Text style={styles.feeValue}>{formatEtb(transferCorrelation.reconciledDestinationBalance)}</Text>
                                            </View>
                                        )}
                                    </View>

                                    {/* Account Selection */}
                                    {transferCorrelation.status === 'OWN_ACCOUNT_MATCHED' ? (
                                        <View style={styles.metaDetails}>
                                            <View style={styles.metaRow}>
                                                <Text style={styles.metaKey}>Current SMS Leg:</Text>
                                                <Text style={[styles.metaValue, { fontWeight: '700' }]}>
                                                    {candidate.type === 'DEBIT' ? 'Source Debit' : 'Destination Credit'} ({getProviderTitle(candidate.providerId)})
                                                </Text>
                                            </View>
                                            <View style={styles.metaRow}>
                                                <Text style={styles.metaKey}>Matching Transaction:</Text>
                                                <Text style={styles.metaValue}>
                                                    {transferCorrelation.matchedTransaction?.note || `Ref: ${transferCorrelation.matchedTransaction?.smsReference || 'Cleared Leg'}`}
                                                </Text>
                                            </View>
                                        </View>
                                    ) : (
                                        <View style={{ marginTop: 12 }}>
                                            <WalletPicker
                                                wallets={wallets.filter((w) => !w.isArchived)}
                                                selectedId={transferSourceWalletId || (candidate.type === 'DEBIT' ? selectedWalletId : '')}
                                                onSelect={(id) => setTransferSourceWalletId(id || '')}
                                                label="Source Account (Debit)"
                                            />
                                            <WalletPicker
                                                wallets={wallets.filter((w) => !w.isArchived)}
                                                selectedId={transferDestWalletId || (candidate.type === 'CREDIT' ? selectedWalletId : '')}
                                                onSelect={(id) => setTransferDestWalletId(id || '')}
                                                label="Destination Account (Credit)"
                                            />
                                        </View>
                                    )}

                                    {/* Note / Description */}
                                    <View style={[styles.noteField, { marginTop: 12 }]}>
                                        <Text style={styles.label}>NOTE (OPTIONAL)</Text>
                                        <TextInput
                                            style={styles.textInput}
                                            value={note}
                                            onChangeText={setNote}
                                            placeholder="e.g. Own account transfer CBE to Telebirr"
                                            placeholderTextColor={colors.textMuted}
                                        />
                                    </View>

                                    {/* Explanatory banner */}
                                    <View style={styles.privacyBanner}>
                                        <ShieldCheck size={16} color={colors.champagne} />
                                        <Text style={styles.privacyBannerText}>
                                            Internal transfer: ETB {transferCorrelation.principalAmount.toFixed(2)} is not counted as earned income or personal spending. Transfer fee is tracked as a financial cost.
                                        </Text>
                                    </View>
                                </View>

                                {/* Action Buttons */}
                                <View style={styles.reviewButtons}>
                                    <TouchableOpacity
                                        style={styles.backButton}
                                        onPress={() => setStep('input')}
                                        disabled={isSaving}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.backButtonText}>Back to Text</Text>
                                    </TouchableOpacity>

                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <PrimaryButton
                                            label={
                                                isSaving
                                                    ? 'Processing...'
                                                    : transferCorrelation.status === 'OWN_ACCOUNT_MATCHED'
                                                    ? 'Confirm & Complete Transfer'
                                                    : 'Record Own-Account Transfer'
                                            }
                                            onPress={handleConfirmTransfer}
                                            disabled={isSaving}
                                            loading={isSaving}
                                        />
                                    </View>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.reviewContainer}>
                            {/* Candidate Summary Card */}
                            <View style={styles.summaryCard}>
                                <View style={styles.summaryTopRow}>
                                    <View style={styles.providerBadge}>
                                        <Building2 size={14} color={colors.champagne} />
                                        <Text style={styles.providerBadgeText}>
                                            {getProviderTitle(candidate.providerId)}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[
                                            styles.directionBadge,
                                            candidate.type === 'DEBIT' ? styles.debitBadge : styles.creditBadge,
                                        ]}
                                        onPress={() => {
                                            const newType = candidate.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
                                            setCandidate({ ...candidate, type: newType });
                                            setSelectedCategoryId('');
                                        }}
                                        activeOpacity={0.75}
                                    >
                                        {candidate.type === 'DEBIT' ? (
                                            <ArrowDownLeft size={13} color={colors.danger} />
                                        ) : (
                                            <ArrowUpRight size={13} color={colors.success} />
                                        )}
                                        <Text
                                            style={[
                                                styles.directionText,
                                                candidate.type === 'DEBIT' ? styles.debitText : styles.creditText,
                                            ]}
                                        >
                                            {candidate.type === 'DEBIT' ? 'EXPENSE' : 'INCOME'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Stated Ledger Amount or Input */}
                                {candidate.ledgerAmount <= 0 ? (
                                    <View style={styles.amountInputSection}>
                                        <Text style={styles.amountInputSectionLabel}>ENTER TRANSACTION AMOUNT (ETB)</Text>
                                        <TextInput
                                            style={styles.amountTextInput}
                                            value={reviewedAmount}
                                            onChangeText={setReviewedAmount}
                                            placeholder="0.00"
                                            placeholderTextColor={colors.textMuted}
                                            keyboardType="decimal-pad"
                                        />
                                    </View>
                                ) : (
                                    <View style={styles.amountDisplay}>
                                        <Text style={styles.amountLabel}>
                                            {candidate.isLedgerAmountDerived ? 'TOTAL DEBIT (INCL. FEES)' : 'LEDGER AMOUNT'}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.amountValue,
                                                candidate.type === 'DEBIT' ? styles.debitAmount : styles.creditAmount,
                                            ]}
                                        >
                                            {candidate.type === 'DEBIT' ? '-' : '+'}
                                            {formatEtb(parseFloat(reviewedAmount) > 0 ? parseFloat(reviewedAmount) : candidate.ledgerAmount)}
                                        </Text>
                                    </View>
                                )}

                                {/* Fees Breakdown If Present */}
                                {candidate.fees && (
                                    <View style={styles.feesContainer}>
                                        <Text style={styles.feesTitle}>FEE BREAKDOWN</Text>
                                        <View style={styles.feeRow}>
                                            <Text style={styles.feeLabel}>Principal Amount:</Text>
                                            <Text style={styles.feeValue}>{formatEtb(candidate.principalAmount)}</Text>
                                        </View>
                                        {candidate.fees.serviceCharge !== undefined && (
                                            <View style={styles.feeRow}>
                                                <Text style={styles.feeLabel}>Service Charge:</Text>
                                                <Text style={styles.feeValue}>{formatEtb(candidate.fees.serviceCharge)}</Text>
                                            </View>
                                        )}
                                        {candidate.fees.vat !== undefined && (
                                            <View style={styles.feeRow}>
                                                <Text style={styles.feeLabel}>VAT (15%):</Text>
                                                <Text style={styles.feeValue}>{formatEtb(candidate.fees.vat)}</Text>
                                            </View>
                                        )}
                                        {candidate.fees.disasterFund !== undefined && (
                                            <View style={styles.feeRow}>
                                                <Text style={styles.feeLabel}>Disaster Recovery:</Text>
                                                <Text style={styles.feeValue}>{formatEtb(candidate.fees.disasterFund)}</Text>
                                            </View>
                                        )}
                                        <View style={[styles.feeRow, styles.feeTotalRow]}>
                                            <Text style={styles.feeTotalLabel}>Total Amount Deducted:</Text>
                                            <Text style={styles.feeTotalValue}>{formatEtb(candidate.ledgerAmount)}</Text>
                                        </View>
                                    </View>
                                )}

                                {/* Metadata Details */}
                                <View style={styles.metaDetails}>
                                    {candidate.accountLast4 && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Account / Phone:</Text>
                                            <Text style={styles.metaValue}>Ending in {candidate.accountLast4}</Text>
                                        </View>
                                    )}
                                    {candidate.counterparty && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Counterparty:</Text>
                                            <Text style={styles.metaValue}>{candidate.counterparty}</Text>
                                        </View>
                                    )}
                                    {candidate.reference && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Txn Reference:</Text>
                                            <Text style={styles.metaValue}>{candidate.reference}</Text>
                                        </View>
                                    )}
                                    {candidate.secondaryReference && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Bank Reference:</Text>
                                            <Text style={styles.metaValue}>{candidate.secondaryReference}</Text>
                                        </View>
                                    )}
                                    {candidate.currentBalance !== undefined && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Post-Txn Balance:</Text>
                                            <Text style={styles.metaValue}>{formatEtb(candidate.currentBalance)}</Text>
                                        </View>
                                    )}
                                </View>
                            </View>

                            {/* Warnings or Ambiguities */}
                            {candidate.warnings && candidate.warnings.length > 0 && (
                                <View style={styles.warningBox}>
                                    <AlertTriangle size={16} color={colors.champagne} />
                                    <View style={styles.warningTextGroup}>
                                        {candidate.warnings.map((w, idx) => (
                                            <Text key={idx} style={styles.warningText}>
                                                {w}
                                            </Text>
                                        ))}
                                    </View>
                                </View>
                            )}

                            {/* Duplicate Warning */}
                            {duplicateWarning && (
                                <View style={styles.duplicateBox}>
                                    <AlertTriangle size={16} color={colors.danger} />
                                    <Text style={styles.duplicateText}>{duplicateWarning}</Text>
                                </View>
                            )}

                            {/* ── PRIORITY FEATURE A: EDUCATION PAYMENT RECOGNITION ── */}
                            {isEducation && (
                                <View style={styles.featureCard}>
                                    <View style={styles.featureHeader}>
                                        <GraduationCap size={18} color={colors.champagne} />
                                        <Text style={styles.featureTitle}>EDUCATION PAYMENT RECOGNIZED</Text>
                                    </View>

                                    <View style={styles.noteField}>
                                        <Text style={styles.label}>INSTITUTION NAME</Text>
                                        <TextInput
                                            style={styles.textInput}
                                            value={eduInstitutionName}
                                            onChangeText={setEduInstitutionName}
                                            placeholder="School, college or academy name"
                                            placeholderTextColor={colors.textMuted}
                                        />
                                    </View>

                                    <Text style={styles.label}>FREQUENCY (PRESELECTED: SEMESTER)</Text>
                                    <View style={styles.featurePillRow}>
                                        {(['Semester', 'Monthly', 'Annual', 'Quarterly', 'One-off'] as EducationFrequency[]).map((freq) => (
                                            <TouchableOpacity
                                                key={freq}
                                                style={[styles.featurePill, eduFrequency === freq && styles.featurePillActive]}
                                                onPress={() => setEduFrequency(freq)}
                                                activeOpacity={0.75}
                                            >
                                                <Text style={[styles.featurePillText, eduFrequency === freq && styles.featurePillTextActive]}>
                                                    {freq}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    <Text style={styles.label}>FEE TYPE (PRESELECTED: TUITION)</Text>
                                    <View style={styles.featurePillRow}>
                                        {(['Tuition', 'Registration', 'Transport', 'Books/Materials', 'Uniform', 'Other'] as EducationFeeType[]).map((type) => (
                                            <TouchableOpacity
                                                key={type}
                                                style={[styles.featurePill, eduFeeType === type && styles.featurePillActive]}
                                                onPress={() => setEduFeeType(type)}
                                                activeOpacity={0.75}
                                            >
                                                <Text style={[styles.featurePillText, eduFeeType === type && styles.featurePillTextActive]}>
                                                    {type}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    <TouchableOpacity
                                        style={styles.checkboxRow}
                                        onPress={() => setEduRemember(!eduRemember)}
                                        activeOpacity={0.75}
                                    >
                                        <View style={[styles.checkboxBox, eduRemember && styles.checkboxBoxActive]}>
                                            {eduRemember && <Check size={14} color="#000" />}
                                        </View>
                                        <Text style={styles.checkboxLabel}>
                                            Remember this institution locally for future payments
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* ── PRIORITY FEATURE B: MERCHANT RECOGNITION ── */}
                            {isMerchant && merchantData && (
                                <View style={styles.featureCard}>
                                    <View style={styles.featureHeader}>
                                        <Store size={18} color={colors.champagne} />
                                        <Text style={styles.featureTitle}>RECOGNIZED MERCHANT</Text>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={styles.metaKey}>Merchant Name:</Text>
                                        <Text style={[styles.metaValue, { fontWeight: '700' }]}>{merchantData.merchantName}</Text>
                                    </View>

                                    {merchantData.merchantType && (
                                        <View style={styles.metaRow}>
                                            <Text style={styles.metaKey}>Merchant Type:</Text>
                                            <Text style={[styles.metaValue, { color: colors.champagne, textTransform: 'capitalize' }]}>
                                                {merchantData.merchantType.replace('_', ' ')}
                                            </Text>
                                        </View>
                                    )}

                                    <TouchableOpacity
                                        style={styles.checkboxRow}
                                        onPress={() => setMerchantRememberRule(!merchantRememberRule)}
                                        activeOpacity={0.75}
                                    >
                                        <View style={[styles.checkboxBox, merchantRememberRule && styles.checkboxBoxActive]}>
                                            {merchantRememberRule && <Check size={14} color="#000" />}
                                        </View>
                                        <Text style={styles.checkboxLabel}>
                                            Remember this category for future payments from this merchant
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* ── PRIORITY FEATURE E: TELECOM PURCHASE BADGE ── */}
                            {telecomPurchaseData && (
                                <View style={styles.featureCard}>
                                    <View style={styles.featureHeader}>
                                        <Wifi size={18} color={colors.champagne} />
                                        <Text style={styles.featureTitle}>TELECOM PACKAGE PURCHASE</Text>
                                    </View>
                                    <Text style={[styles.metaValue, { color: colors.textPrimary }]}>
                                        {telecomPurchaseData.packageName || 'Telecom Package'}
                                        {telecomPurchaseData.volumeText ? ` (${telecomPurchaseData.volumeText})` : ''}
                                    </Text>
                                </View>
                            )}

                            {/* ── PRIORITY FEATURE C: BILL SPLITTING & REIMBURSEMENTS ── */}
                            {candidate.type === 'DEBIT' && (
                                <View style={styles.featureCard}>
                                    <TouchableOpacity
                                        style={styles.splitToggleRow}
                                        onPress={() => {
                                            const nextVal = !isSplitExpense;
                                            setIsSplitExpense(nextVal);
                                            if (nextVal && !personalShare) {
                                                const finalAmt = parseFloat(reviewedAmount) > 0 ? parseFloat(reviewedAmount) : candidate.ledgerAmount;
                                                setPersonalShare((finalAmt / 2).toFixed(2));
                                                setParticipants([{ name: '', amount: (finalAmt / 2).toFixed(2) }]);
                                            }
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <View style={styles.splitToggleLabel}>
                                            <Users size={16} color={colors.champagne} />
                                            <Text style={styles.splitToggleText}>Split this expense with others?</Text>
                                        </View>
                                        <View style={[styles.checkboxBox, isSplitExpense && styles.checkboxBoxActive]}>
                                            {isSplitExpense && <Check size={14} color="#000" />}
                                        </View>
                                    </TouchableOpacity>

                                    {isSplitExpense && (
                                        <View style={{ gap: 10, marginTop: 8 }}>
                                            <View style={styles.noteField}>
                                                <Text style={styles.label}>MY PERSONAL SHARE (ETB)</Text>
                                                <TextInput
                                                    style={styles.textInput}
                                                    value={personalShare}
                                                    onChangeText={setPersonalShare}
                                                    placeholder="0.00"
                                                    placeholderTextColor={colors.textMuted}
                                                    keyboardType="decimal-pad"
                                                />
                                            </View>

                                            <Text style={styles.label}>PARTICIPANTS & AMOUNTS OWED</Text>
                                            {participants.map((p, idx) => (
                                                <View key={idx} style={styles.participantRow}>
                                                    <TextInput
                                                        style={styles.participantNameInput}
                                                        placeholder="Participant Name"
                                                        placeholderTextColor={colors.textMuted}
                                                        value={p.name}
                                                        onChangeText={(val) => {
                                                            const copy = [...participants];
                                                            copy[idx].name = val;
                                                            setParticipants(copy);
                                                        }}
                                                    />
                                                    <TextInput
                                                        style={styles.participantAmountInput}
                                                        placeholder="ETB"
                                                        placeholderTextColor={colors.textMuted}
                                                        value={p.amount}
                                                        keyboardType="decimal-pad"
                                                        onChangeText={(val) => {
                                                            const copy = [...participants];
                                                            copy[idx].amount = val;
                                                            setParticipants(copy);
                                                        }}
                                                    />
                                                    {participants.length > 1 && (
                                                        <TouchableOpacity
                                                            onPress={() => setParticipants(participants.filter((_, i) => i !== idx))}
                                                            style={{ padding: 4 }}
                                                        >
                                                            <Trash2 size={16} color={colors.danger} />
                                                        </TouchableOpacity>
                                                    )}
                                                </View>
                                            ))}

                                            <TouchableOpacity
                                                style={styles.addParticipantBtn}
                                                onPress={() => setParticipants([...participants, { name: '', amount: '' }])}
                                                activeOpacity={0.7}
                                            >
                                                <Text style={styles.addParticipantBtnText}>+ Add Another Participant</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            )}

                            {/* Reconciliation Inputs */}
                            <View style={styles.reconcileSection}>
                                <Text style={styles.sectionHeader}>RECONCILE & ASSIGN</Text>

                                {/* Wallet Matching Status Banner */}
                                {walletMatch && (
                                    <View style={styles.walletMatchBanner}>
                                        {walletMatch.confidence === 'exact_account' ? (
                                            <>
                                                <CheckCircle2 size={16} color={colors.success} />
                                                <Text style={styles.walletMatchText}>
                                                    Auto-matched account ending in {candidate.accountLast4}
                                                </Text>
                                            </>
                                        ) : walletMatch.confidence === 'provider_only' ? (
                                            <>
                                                <CheckCircle2 size={16} color={colors.champagne} />
                                                <Text style={styles.walletMatchText}>
                                                    Pre-selected {getProviderTitle(candidate.providerId)} wallet
                                                </Text>
                                            </>
                                        ) : walletMatch.confidence === 'ambiguous' ? (
                                            <>
                                                <AlertTriangle size={16} color={colors.champagne} />
                                                <Text style={styles.walletMatchText}>
                                                    Multiple matching wallets. Please choose one.
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle size={16} color={colors.textSecondary} />
                                                <Text style={styles.walletMatchText}>
                                                    No provider wallet found. Select an active wallet below.
                                                </Text>
                                            </>
                                        )}
                                    </View>
                                )}

                                {/* Wallet Picker */}
                                <WalletPicker
                                    wallets={wallets.filter((w) => !w.isArchived)}
                                    selectedId={selectedWalletId}
                                    onSelect={(id) => setSelectedWalletId(id || '')}
                                    label="Target Wallet"
                                />

                                {/* Category Picker */}
                                <CategoryPicker
                                    categories={flowCategories}
                                    selectedId={selectedCategoryId}
                                    onSelect={setSelectedCategoryId}
                                    label={candidate.type === 'DEBIT' ? 'Expense Category' : 'Income Category'}
                                    placeholder={
                                        candidate.type === 'DEBIT'
                                            ? 'Select expense category'
                                            : 'Select income category'
                                    }
                                    flow={candidate.type === 'DEBIT' ? 'EXPENSE' : 'INCOME'}
                                />

                                {/* Note / Description Input */}
                                <View style={styles.noteField}>
                                    <Text style={styles.label}>NOTE / DESCRIPTION</Text>
                                    <TextInput
                                        style={styles.textInput}
                                        value={note}
                                        onChangeText={setNote}
                                        placeholder="Add a note or counterparty info"
                                        placeholderTextColor={colors.textMuted}
                                    />
                                </View>

                                {/* Date/Time Confirmation */}
                                <View style={styles.dateConfirmation}>
                                    <Calendar size={16} color={colors.textSecondary} />
                                    <Text style={styles.dateConfirmText}>
                                        {candidate.dateTime ? 'Date: ' : 'Date (Manual/Current): '}
                                        {new Date(confirmedDate).toLocaleString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </Text>
                                </View>
                            </View>

                            {/* Action Buttons */}
                            <View style={styles.reviewButtons}>
                                <TouchableOpacity
                                    style={styles.backButton}
                                    onPress={() => setStep('input')}
                                    disabled={isSaving}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.backButtonText}>Back to Text</Text>
                                </TouchableOpacity>

                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <PrimaryButton
                                        label={isSaving ? 'Importing...' : 'Confirm & Import'}
                                        onPress={handleConfirmImport}
                                        disabled={isSaving}
                                        loading={isSaving}
                                    />
                                </View>
                            </View>
                        </View>
                    )
                )
            )}
            </ScrollView>
        </ModalShell>
    );
}

const createStyles = (colors: ReturnType<typeof useTheme>) =>
    StyleSheet.create({
        scrollArea: {
            maxHeight: 520,
        },
        scrollContent: {
            padding: 20,
            paddingBottom: 32,
        },
        inputContainer: {
            gap: 16,
        },
        privacyBanner: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: `${colors.champagne}15`,
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: `${colors.champagne}35`,
        },
        privacyBannerText: {
            flex: 1,
            color: colors.champagne,
            fontSize: 12,
            lineHeight: 16,
        },
        label: {
            color: colors.textSecondary,
            fontSize: 11,
            fontWeight: '600',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginBottom: 6,
        },
        providerScrollView: {
            marginBottom: 8,
            marginHorizontal: -4,
        },
        providerScroll: {
            paddingHorizontal: 4,
            gap: 8,
            flexDirection: 'row',
            alignItems: 'center',
        },
        providerTab: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 8,
            backgroundColor: 'transparent',
            borderBottomWidth: 2,
            borderBottomColor: 'transparent',
        },
        providerTabActive: {
            borderBottomColor: colors.champagne,
        },
        providerAutoBadge: {
            alignItems: 'center',
            justifyContent: 'center',
        },
        providerAutoBadgeActive: {},
        providerLogo: {},
        providerTabText: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: '500',
        },
        providerTabTextActive: {
            color: colors.champagne,
            fontWeight: '700',
        },
        amountInputSection: {
            marginTop: 8,
            padding: 12,
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.champagne,
        },
        amountInputSectionLabel: {
            fontSize: 11,
            fontWeight: '700',
            color: colors.champagne,
            letterSpacing: 0.5,
            marginBottom: 6,
        },
        amountTextInput: {
            fontSize: 22,
            fontWeight: '700',
            color: colors.textPrimary,
            paddingVertical: 4,
        },
        smsInputHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        clearButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingVertical: 2,
            paddingHorizontal: 6,
        },
        clearButtonText: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        textArea: {
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.textPrimary,
            fontSize: 14,
            lineHeight: 20,
            padding: 14,
            minHeight: 120,
        },
        errorBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: `${colors.danger}18`,
            borderRadius: 8,
            padding: 12,
            borderWidth: 1,
            borderColor: `${colors.danger}40`,
        },
        errorText: {
            flex: 1,
            color: colors.danger,
            fontSize: 13,
            lineHeight: 18,
        },
        buttonContainer: {
            marginTop: 8,
        },
        reviewContainer: {
            gap: 16,
        },
        summaryCard: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.cardBorder || colors.border,
            padding: 16,
            gap: 12,
        },
        summaryTopRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        providerBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        providerBadgeText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: '600',
        },
        directionBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingVertical: 4,
            paddingHorizontal: 8,
            borderRadius: 999,
        },
        debitBadge: {
            backgroundColor: `${colors.danger}20`,
        },
        creditBadge: {
            backgroundColor: `${colors.success}20`,
        },
        directionText: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.5,
        },
        debitText: {
            color: colors.danger,
        },
        creditText: {
            color: colors.success,
        },
        amountDisplay: {
            alignItems: 'center',
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        amountLabel: {
            color: colors.textSecondary,
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.5,
            marginBottom: 4,
        },
        amountValue: {
            fontSize: 28,
            fontWeight: '800',
            letterSpacing: 0.5,
        },
        debitAmount: {
            color: colors.danger,
        },
        creditAmount: {
            color: colors.success,
        },
        feesContainer: {
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            padding: 12,
            gap: 6,
        },
        feesTitle: {
            color: colors.champagne,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.5,
            marginBottom: 2,
        },
        feeRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        feeLabel: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        feeValue: {
            color: colors.textPrimary,
            fontSize: 12,
            fontWeight: '500',
        },
        feeTotalRow: {
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: 6,
            marginTop: 4,
        },
        feeTotalLabel: {
            color: colors.champagne,
            fontSize: 12,
            fontWeight: '600',
        },
        feeTotalValue: {
            color: colors.champagne,
            fontSize: 13,
            fontWeight: '700',
        },
        metaDetails: {
            gap: 6,
            paddingTop: 4,
        },
        metaRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        metaKey: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        metaValue: {
            color: colors.textPrimary,
            fontSize: 12,
            fontWeight: '500',
        },
        warningBox: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            backgroundColor: `${colors.champagne}15`,
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: `${colors.champagne}35`,
        },
        warningTextGroup: {
            flex: 1,
            gap: 4,
        },
        warningText: {
            color: colors.champagne,
            fontSize: 12,
            lineHeight: 16,
        },
        duplicateBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: `${colors.danger}15`,
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: `${colors.danger}35`,
        },
        duplicateText: {
            flex: 1,
            color: colors.danger,
            fontSize: 12,
            lineHeight: 16,
        },
        reconcileSection: {
            gap: 14,
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
        },
        sectionHeader: {
            color: colors.champagne,
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.5,
            marginBottom: 2,
        },
        walletMatchBanner: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.surfaceAlt,
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
        },
        walletMatchText: {
            color: colors.textSecondary,
            fontSize: 12,
            flex: 1,
        },
        noteField: {
            gap: 4,
        },
        textInput: {
            backgroundColor: colors.surfaceAlt,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.textPrimary,
            fontSize: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
        },
        dateConfirmation: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingTop: 4,
        },
        dateConfirmText: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        reviewButtons: {
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
        },
        backButton: {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
        },
        backButtonText: {
            color: colors.textSecondary,
            fontSize: 14,
            fontWeight: '600',
        },
        featureCard: {
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.cardBorder || colors.border,
            padding: 14,
            gap: 10,
        },
        featureHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        featureTitle: {
            fontSize: 12,
            fontWeight: '700',
            color: colors.champagne,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
        },
        featurePillRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
        },
        featurePill: {
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
        },
        featurePillActive: {
            borderColor: colors.champagne,
            backgroundColor: `${colors.champagne}20`,
        },
        featurePillText: {
            fontSize: 12,
            color: colors.textSecondary,
            fontWeight: '500',
        },
        featurePillTextActive: {
            color: colors.champagne,
            fontWeight: '700',
        },
        checkboxRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
        },
        checkboxBox: {
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: colors.champagne,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceAlt,
        },
        checkboxBoxActive: {
            backgroundColor: colors.champagne,
        },
        checkboxLabel: {
            fontSize: 12,
            color: colors.textPrimary,
            flex: 1,
        },
        splitToggleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        splitToggleLabel: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        splitToggleText: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textPrimary,
        },
        participantRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        participantNameInput: {
            flex: 2,
            backgroundColor: colors.surfaceAlt,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.textPrimary,
            fontSize: 13,
            paddingHorizontal: 10,
            paddingVertical: 8,
        },
        participantAmountInput: {
            flex: 1,
            backgroundColor: colors.surfaceAlt,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.textPrimary,
            fontSize: 13,
            paddingHorizontal: 10,
            paddingVertical: 8,
        },
        addParticipantBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.champagne,
            marginTop: 4,
        },
        addParticipantBtnText: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.champagne,
        },
    });
