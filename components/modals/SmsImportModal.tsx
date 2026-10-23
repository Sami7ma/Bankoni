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

interface SmsImportModalProps {
    visible: boolean;
    onClose: () => void;
}

const PROVIDER_OPTIONS: Array<{ id: SmsProviderId | 'auto'; label: string }> = [
    { id: 'auto', label: 'Auto-Detect' },
    { id: 'cbe', label: 'CBE' },
    { id: 'dashen', label: 'Dashen' },
    { id: 'telebirr', label: 'Telebirr' },
    { id: 'mpesa', label: 'M-PESA' },
    { id: 'awash', label: 'Awash' },
    { id: 'boa', label: 'BOA' },
    { id: 'cbe_birr', label: 'CBE Birr' },
];

export default function SmsImportModal({ visible, onClose }: SmsImportModalProps) {
    const colors = useTheme();
    const styles = createStyles(colors);

    // Zustand store
    const wallets = useBanKoniStore((state) => state.wallets);
    const categories = useBanKoniStore((state) => state.categories);
    const addTransaction = useBanKoniStore((state) => state.addTransaction);

    // Workflow state
    const [step, setStep] = useState<'input' | 'review'>('input');
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

    // Deduplication & submission state
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const [isDuplicate, setIsDuplicate] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Reset when modal opens or closes
    useEffect(() => {
        if (visible) {
            setStep('input');
            setRawText('');
            setCandidate(null);
            setParseError(null);
            setDuplicateWarning(null);
            setIsDuplicate(false);
            setProviderSelection('auto');
            setSelectedWalletId('');
            setSelectedCategoryId('');
            setNote('');
            setReviewedAmount('');
        }
    }, [visible]);

    // Handle parsing the pasted text
    const handleParse = async () => {
        setParseError(null);
        if (!rawText.trim()) {
            setParseError('Please paste an SMS transaction message first.');
            return;
        }

        const result = parseSms(rawText, providerSelection);

        if (result.status === 'parsed') {
            const parsedCandidate = result.candidate;
            setCandidate(parsedCandidate);

            // 1. Match wallet using provider and account identifiers
            const match = matchWalletForCandidate(parsedCandidate, wallets);
            setWalletMatch(match);
            if (match.matchedWallet) {
                setSelectedWalletId(match.matchedWallet.id);
            } else {
                // Never silently select an arbitrary wallet when match is ambiguous or missing.
                // Leave empty so user must explicitly choose from the picker.
                setSelectedWalletId('');
            }

            // 2. Set default date
            const initialDate = parsedCandidate.dateTime || new Date().toISOString();
            setConfirmedDate(initialDate);

            // 3. Set pre-filled note and initial reviewed amount
            setNote(parsedCandidate.description || 'SMS Transaction');
            setReviewedAmount(parsedCandidate.ledgerAmount > 0 ? parsedCandidate.ledgerAmount.toString() : '');

            // 4. Duplicate pre-check
            // When dateTime is absent from SMS, incorporate the initial date to avoid false duplicate collisions
            const candidateForFp = {
                ...parsedCandidate,
                dateTime: parsedCandidate.dateTime || initialDate,
            };
            const fingerprint = generateSmsFingerprint(candidateForFp);
            const dupCheck = await checkSmsDuplicateDB(parsedCandidate.reference, fingerprint);

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

            // 5. Automatic category detection for internet / data packages (Telebirr & M-PESA)
            let autoCatId = '';
            const isInternetPackage =
                /internet\s+package|daily\s+internet|monthly\s+internet|unlimited\s+internet|data\s+package|safaricom\s+bundle|\bbundle\b/i.test(
                    (parsedCandidate.description || '') + ' ' + rawText
                );

            if (isInternetPackage && parsedCandidate.type === 'DEBIT') {
                const netCat = categories.find(
                    (c) => c.flow === 'EXPENSE' && /internet|package|bundle|telecom|wifi/i.test(c.name)
                );
                if (netCat) {
                    autoCatId = netCat.id;
                }
            }
            setSelectedCategoryId(autoCatId);

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

    const executeImport = async () => {
        if (!candidate) return;

        const parsedAmt = parseFloat(reviewedAmount.trim());
        const finalAmount = !isNaN(parsedAmt) && parsedAmt > 0 ? parsedAmt : candidate.ledgerAmount;

        if (!finalAmount || finalAmount <= 0) {
            Alert.alert('Amount Required', 'Please enter a valid transaction amount.');
            return;
        }

        setIsSaving(true);
        try {
            const candidateForFp = {
                ...candidate,
                ledgerAmount: finalAmount,
                principalAmount: finalAmount,
                dateTime: confirmedDate || candidate.dateTime,
            };
            const fingerprint = generateSmsFingerprint(candidateForFp);

            await addTransaction({
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
            });

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
                title={step === 'input' ? 'Paste SMS' : 'Review & Import'}
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
                ) : (
                    candidate && (
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
            gap: 8,
            paddingVertical: 7,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1.5,
            borderColor: colors.border,
        },
        providerTabActive: {
            backgroundColor: `${colors.champagne}18`,
            borderColor: colors.champagne,
        },
        providerAutoBadge: {
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
        },
        providerAutoBadgeActive: {
            backgroundColor: `${colors.champagne}25`,
        },
        providerLogo: {
            borderRadius: 6,
        },
        providerTabText: {
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: '600',
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
    });
