import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Transaction } from '../../types/Transaction';
import type { Wallet } from '../../types/Wallet';
import { createSqliteFixture } from './sqliteFixture';

const cashWalletId = 'wallet-cash-default';
const date = '2026-11-01T09:00:00.000Z';

function makeTx(id: string, overrides: Partial<Transaction> = {}): Transaction {
    return {
        id,
        amount: 50,
        type: 'DEBIT',
        categoryId: 'cat-1',
        date,
        status: 'CLEARED',
        walletId: cashWalletId,
        createdAt: date,
        ...overrides,
    };
}

describe('Financial Relationships SQLite Integration Tests', () => {
    let fixture: ReturnType<typeof createSqliteFixture>;
    let repository: typeof import('../database');

    beforeEach(async () => {
        fixture = createSqliteFixture();
        jest.resetModules();
        jest.doMock('expo-sqlite', () => ({
            openDatabaseAsync: jest.fn(async (name: string, options: unknown) => {
                expect(name).toBe('bankoni.db');
                expect(options).toEqual({ useNewConnection: true });
                return fixture.open();
            }),
        }));
        repository = require('../database');
        await repository.initDatabase();
    });

    afterEach(() => {
        fixture.dispose();
        jest.dontMock('expo-sqlite');
    });

    it('creates an atomic transfer between two wallets and records legs and fees', async () => {
        // Create second wallet
        const telebirrWallet: Wallet = {
            id: 'wallet-telebirr',
            name: 'Telebirr',
            icon: 'smartphone',
            providerId: 'telebirr',
            openingBalance: 1000,
            balance: 1000,
            currency: 'ETB',
            isDefault: false,
            isArchived: false,
            createdAt: date,
        };
        await repository.insertWalletDB(telebirrWallet);

        // Put 5000 in cash wallet
        await repository.insertTransactionDB(makeTx('tx-initial-cash', {
            amount: 5000,
            type: 'CREDIT',
            categoryId: 'cat-18', // Salary / Income
            walletId: cashWalletId,
        }));

        const initialWallets = await repository.getWalletsDB();
        const cashBefore = initialWallets.find((w) => w.id === cashWalletId)!.balance;
        const telebirrBefore = initialWallets.find((w) => w.id === 'wallet-telebirr')!.balance;

        // Perform transfer of 1,500 with 15 fee
        const transfer = await repository.createTransferDB({
            fromWalletId: cashWalletId,
            toWalletId: 'wallet-telebirr',
            amount: 1500,
            feeAmount: 15,
            note: 'Top up telebirr',
            date,
        });

        expect(transfer.amount).toBe(1500);
        expect(transfer.feeAmount).toBe(15);
        expect(transfer.fromWalletId).toBe(cashWalletId);
        expect(transfer.toWalletId).toBe('wallet-telebirr');

        const walletsAfter = await repository.getWalletsDB();
        const cashAfter = walletsAfter.find((w) => w.id === cashWalletId)!.balance;
        const telebirrAfter = walletsAfter.find((w) => w.id === 'wallet-telebirr')!.balance;

        // Cash should decrease by amount + fee = 1515
        expect(cashAfter).toBe(cashBefore - 1515);
        // Telebirr should increase by amount = 1500
        expect(telebirrAfter).toBe(telebirrBefore + 1500);

        // Check transactions
        const txs = await repository.getTransactionsDB();
        const outLeg = txs.find((t) => t.id === transfer.fromTransactionId);
        const inLeg = txs.find((t) => t.id === transfer.toTransactionId);
        const feeLeg = txs.find((t) => t.id === transfer.feeTransactionId);

        expect(outLeg?.isTransfer).toBe(true);
        expect(outLeg?.subType).toBe('TRANSFER');
        expect(inLeg?.isTransfer).toBe(true);
        expect(inLeg?.subType).toBe('TRANSFER');
        expect(feeLeg?.subType).toBe('FEE');

        // Check transfers query
        const allTransfers = await repository.getTransfersDB();
        expect(allTransfers.length).toBe(1);
        expect(allTransfers[0].id).toBe(transfer.id);

        // Reject invalid transfer to same wallet
        await expect(repository.createTransferDB({
            fromWalletId: cashWalletId,
            toWalletId: cashWalletId,
            amount: 100,
        })).rejects.toThrow('Transfer requires two distinct wallets.');
    });

    it('allocates refunds against original purchase transactions', async () => {
        // Initial income
        await repository.insertTransactionDB(makeTx('tx-income-1', {
            amount: 10000,
            type: 'CREDIT',
            categoryId: 'cat-18',
        }));

        // Purchase of shoes for 2,400
        await repository.insertTransactionDB(makeTx('tx-purchase-shoes', {
            amount: 2400,
            type: 'DEBIT',
            categoryId: 'cat-1',
            note: 'Shoes from boutique',
        }));

        // Refund credit of 800
        await repository.insertTransactionDB(makeTx('tx-refund-credit', {
            amount: 800,
            type: 'CREDIT',
            categoryId: 'cat-20',
            note: 'Partial shoe return',
        }));

        const allocation = await repository.allocateRefundDB({
            refundTransactionId: 'tx-refund-credit',
            originalTransactionId: 'tx-purchase-shoes',
            allocatedAmount: 800,
            notes: 'Returned defective pair',
        });

        expect(allocation.allocatedAmount).toBe(800);
        expect(allocation.originalTransactionId).toBe('tx-purchase-shoes');

        const allAllocations = await repository.getRefundAllocationsDB();
        expect(allAllocations.length).toBe(1);
        expect(allAllocations[0].allocatedAmount).toBe(800);

        // Transaction should be updated to REFUND subtype
        const txs = await repository.getTransactionsDB();
        const refundTx = txs.find((t) => t.id === 'tx-refund-credit');
        expect(refundTx?.subType).toBe('REFUND');
    });

    it('manages shared expenses and multiple partial reimbursements without double counting', async () => {
        // Setup cash
        await repository.insertTransactionDB(makeTx('tx-income-pool', {
            amount: 10000,
            type: 'CREDIT',
            categoryId: 'cat-18',
        }));

        // Group dinner bill of ETB 1,200
        await repository.insertTransactionDB(makeTx('tx-dinner-1200', {
            amount: 1200,
            type: 'DEBIT',
            categoryId: 'cat-2', // Food & Dining
            note: 'Group dinner at Kuriftu',
        }));

        // Create shared expense: user share 300, 3 friends owe 300 each (900 total)
        const sharedExpense = await repository.createSharedExpenseDB({
            transactionId: 'tx-dinner-1200',
            totalAmount: 1200,
            personalShare: 300,
            description: 'Group dinner',
            participants: [
                { name: 'Abebe', expectedAmount: 300 },
                { name: 'Almaz', expectedAmount: 300 },
                { name: 'Chala', expectedAmount: 300 },
            ],
        });

        expect(sharedExpense.totalAmount).toBe(1200);
        expect(sharedExpense.personalShare).toBe(300);
        expect(sharedExpense.participants.length).toBe(3);
        expect(sharedExpense.outstandingReceivable).toBe(900);
        expect(sharedExpense.realizedPersonalCost).toBe(1200); // 0 reimbursed so far

        // Friend 1 (Abebe) pays 300 reimbursement
        await repository.insertTransactionDB(makeTx('tx-reimb-1', {
            amount: 300,
            type: 'CREDIT',
            categoryId: 'cat-20',
            note: 'Abebe dinner share',
        }));

        const abebeId = sharedExpense.participants.find((p) => p.name === 'Abebe')!.id;
        await repository.allocateReimbursementDB({
            reimbursementTransactionId: 'tx-reimb-1',
            sharedExpenseId: sharedExpense.id,
            participantId: abebeId,
            allocatedAmount: 300,
        });

        let allShared = await repository.getSharedExpensesDB();
        expect(allShared[0].totalReimbursed).toBe(300);
        expect(allShared[0].outstandingReceivable).toBe(600);
        expect(allShared[0].realizedPersonalCost).toBe(900);

        // Friend 2 (Almaz) pays 300 reimbursement
        await repository.insertTransactionDB(makeTx('tx-reimb-2', {
            amount: 300,
            type: 'CREDIT',
            categoryId: 'cat-20',
            note: 'Almaz dinner share',
        }));
        const almazId = sharedExpense.participants.find((p) => p.name === 'Almaz')!.id;
        await repository.allocateReimbursementDB({
            reimbursementTransactionId: 'tx-reimb-2',
            sharedExpenseId: sharedExpense.id,
            participantId: almazId,
            allocatedAmount: 300,
        });

        // Friend 3 (Chala) pays 300 reimbursement
        await repository.insertTransactionDB(makeTx('tx-reimb-3', {
            amount: 300,
            type: 'CREDIT',
            categoryId: 'cat-20',
            note: 'Chala dinner share',
        }));
        const chalaId = sharedExpense.participants.find((p) => p.name === 'Chala')!.id;
        await repository.allocateReimbursementDB({
            reimbursementTransactionId: 'tx-reimb-3',
            sharedExpenseId: sharedExpense.id,
            participantId: chalaId,
            allocatedAmount: 300,
        });

        allShared = await repository.getSharedExpensesDB();
        expect(allShared[0].totalReimbursed).toBe(900);
        expect(allShared[0].outstandingReceivable).toBe(0);
        expect(allShared[0].realizedPersonalCost).toBe(300);
    });

    it('tracks loans, disbursements, repayments, and settlement', async () => {
        // Initial funds
        await repository.insertTransactionDB(makeTx('tx-income-loan', {
            amount: 20000,
            type: 'CREDIT',
            categoryId: 'cat-18',
        }));

        const walletBefore = (await repository.getWalletsDB()).find((w) => w.id === cashWalletId)!.balance;

        // User lends ETB 5,000 to Henok
        const loan = await repository.createLoanDB({
            type: 'LENT',
            counterparty: 'Henok',
            principalAmount: 5000,
            walletId: cashWalletId,
            createTransaction: true,
            dueDate: '2026-12-01',
            notes: 'Emergency loan',
        });

        expect(loan.principalAmount).toBe(5000);
        expect(loan.counterparty).toBe('Henok');
        expect(loan.status).toBe('ACTIVE');

        const walletAfterDisb = (await repository.getWalletsDB()).find((w) => w.id === cashWalletId)!.balance;
        expect(walletAfterDisb).toBe(walletBefore - 5000);

        // Repayment 1: Henok repays 2,500
        await repository.recordLoanRepaymentDB({
            loanId: loan.id,
            principalRepaid: 2500,
            walletId: cashWalletId,
            createTransaction: true,
            repaymentDate: '2026-11-15',
            notes: 'Half repayment',
        });

        let loans = await repository.getLoansDB();
        expect(loans[0].totalPrincipalRepaid).toBe(2500);
        expect(loans[0].remainingPrincipal).toBe(2500);
        expect(loans[0].status).toBe('ACTIVE');

        // Repayment 2: Henok repays remaining 2,500
        await repository.recordLoanRepaymentDB({
            loanId: loan.id,
            principalRepaid: 2500,
            walletId: cashWalletId,
            createTransaction: true,
            repaymentDate: '2026-11-20',
            notes: 'Final repayment',
        });

        loans = await repository.getLoansDB();
        expect(loans[0].totalPrincipalRepaid).toBe(5000);
        expect(loans[0].remainingPrincipal).toBe(0);
        expect(loans[0].status).toBe('SETTLED');

        const walletFinal = (await repository.getWalletsDB()).find((w) => w.id === cashWalletId)!.balance;
        expect(walletFinal).toBe(walletBefore); // Full principal recovered
    });

    it('persists and retrieves merchants, aliases, and category rules', async () => {
        const merchant = await repository.saveMerchantDB({
            id: 'm-kaldis',
            name: "Kaldi's Coffee",
            normalizedName: 'kaldis coffee',
            merchantType: 'coffee_shop',
            defaultCategoryId: 'cat-2',
        });

        expect(merchant.name).toBe("Kaldi's Coffee");

        await repository.addMerchantAliasDB('kaldis sarbet', merchant.id);
        await repository.saveMerchantRuleDB({
            id: 'mr-kaldis',
            pattern: 'kaldis',
            merchantId: merchant.id,
            categoryId: 'cat-2',
            autoApply: true,
        });

        const merchants = await repository.getMerchantsDB();
        expect(merchants.length).toBe(1);
        expect(merchants[0].normalizedName).toBe('kaldis coffee');

        const rules = await repository.getMerchantRulesDB();
        expect(rules.length).toBe(1);
        expect(rules[0].pattern).toBe('kaldis');
    });

    it('persists education institutions, preferences, and commitments', async () => {
        const inst = await repository.saveEducationInstitutionDB({
            id: 'inst-sandford',
            name: 'Sandford International School',
            normalizedName: 'sandford international school',
            defaultCategoryId: 'cat-10', // Education category if exists or standard
            preferredFrequency: 'Semester',
            preferredFeeType: 'Tuition',
        });

        expect(inst.preferredFrequency).toBe('Semester');
        expect(inst.preferredFeeType).toBe('Tuition');

        await repository.saveEducationCommitmentDB({
            id: 'ec-1',
            institutionId: inst.id,
            studentName: 'Kirubel',
            feeType: 'Tuition',
            frequency: 'Semester',
            expectedAmount: 45000,
            academicTerm: 'Term 1',
            academicYear: '2026/2027',
        });

        const institutions = await repository.getEducationInstitutionsDB();
        expect(institutions.length).toBe(1);
        expect(institutions[0].name).toBe('Sandford International School');

        const commitments = await repository.getEducationCommitmentsDB();
        expect(commitments.length).toBe(1);
        expect(commitments[0].expectedAmount).toBe(45000);
    });

    it('records bill confirmations and telecom package events', async () => {
        // Bill confirmation
        const bill = await repository.insertBillConfirmationDB({
            id: 'bc-ethio-1',
            billerName: 'Ethio Telecom',
            accountNumber: '0911223344',
            billReference: 'ET-BILL-9988',
            amount: 1874.99,
            rawMessage: 'Dear customer, your bill payment of 1,874.99 ETB has been received.',
            messageDate: date,
            status: 'UNMATCHED',
        });

        expect(bill.status).toBe('UNMATCHED');
        expect(bill.amount).toBe(1874.99);

        // Insert actual transaction to satisfy foreign key
        await repository.insertTransactionDB(makeTx('tx-test-matched', {
            amount: 1874.99,
            type: 'DEBIT',
            categoryId: 'cat-4',
        }));

        await repository.linkBillConfirmationDB('bc-ethio-1', 'tx-test-matched');
        const bills = await repository.getBillConfirmationsDB();
        expect(bills[0].status).toBe('MATCHED');
        expect(bills[0].matchedTransactionId).toBe('tx-test-matched');

        // Telecom event
        const telecomEvent = await repository.insertTelecomEventDB({
            id: 'te-1',
            packageInstanceId: 'pkg-daily-360',
            packageName: 'Daily Internet Package 360 MB',
            eventType: 'DEPLETION',
            eventTime: date,
            volumeText: '360 MB',
            rawSms: 'Daily Internet Package 360 MB finished.',
        });

        expect(telecomEvent.eventType).toBe('DEPLETION');
        const allEvents = await repository.getTelecomEventsDB();
        expect(allEvents.length).toBe(1);
        expect(allEvents[0].packageName).toBe('Daily Internet Package 360 MB');
    });

    it('persists and updates recurring commitments', async () => {
        const commitment = await repository.saveRecurringCommitmentDB({
            id: 'rc-wifi',
            name: 'Home Fiber Internet',
            commitmentType: 'utility',
            categoryId: 'cat-4', // Utilities
            expectedAmount: 1874.99,
            isVariableAmount: false,
            frequency: 'monthly',
            billingDay: 25,
            nextExpectedDate: '2026-11-25',
            status: 'OBSERVED',
        });

        expect(commitment.status).toBe('OBSERVED');
        await repository.updateRecurringCommitmentStatusDB('rc-wifi', 'CONFIRMED');

        const commitments = await repository.getRecurringCommitmentsDB();
        expect(commitments[0].status).toBe('CONFIRMED');
        expect(commitments[0].expectedAmount).toBe(1874.99);
    });
});
