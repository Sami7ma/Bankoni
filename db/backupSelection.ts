import type {ExportDataPayload} from '../types/User';
import {FINANCIAL_TABLES,type FinancialSnapshot,type FinancialTable} from './portableBackup';
export interface ExportSelection {accounts:boolean;transactions:boolean;budgets:boolean;preferences:boolean}
export const ALL_EXPORT:ExportSelection={accounts:true,transactions:true,budgets:true,preferences:true};
export function validateSelection(value:unknown):ExportSelection {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==4 || Object.keys(ALL_EXPORT).some(k=>typeof (value as Record<string,unknown>)[k]!=='boolean'))throw Error('Invalid backup selection.');
 const s=value as ExportSelection;if(!Object.values(s).some(Boolean) || (s.transactions&&!s.accounts))throw Error('Transactions require their accounts. Choose at least one section.');return s;
}
const included=(table:FinancialTable,s:ExportSelection)=>table==='budgets'?s.budgets:table==='categories'?(s.transactions||s.budgets):table==='wallets'||table==='known_accounts'?s.accounts:s.transactions;
/** Credential-free financial sections. Empty sections contain no unselected records. */
export function selectBackup(payload:ExportDataPayload,selection:ExportSelection):ExportDataPayload {
 const s=validateSelection(selection);if(Object.values(s).every(Boolean))return payload;
 const tables={} as FinancialSnapshot;
 for(const table of FINANCIAL_TABLES)tables[table]=included(table,s)?payload.financialTables![table].map(row=>({...row})):[];
 if(s.budgets&&!s.transactions){const ids=new Set(tables.budgets.map(b=>b.category_id));tables.categories=tables.categories.filter(c=>ids.has(c.id));}
 // An account-only transfer starts at its exported balance, not at an old opening
 // whose omitted transaction history would otherwise change the displayed balance.
 if(s.accounts&&!s.transactions)tables.wallets=tables.wallets.map(row=>({...row,opening_balance:row.balance}));
 return {...payload,version:'3.0.0',selection:s,user:s.accounts?payload.user:null,
   wallets:s.accounts?payload.wallets.map(w=>s.transactions?w:{...w,openingBalance:w.balance}):[],
   transactions:s.transactions?payload.transactions:[],budgets:s.budgets?payload.budgets:[],categories:s.transactions?payload.categories:s.budgets?payload.categories.filter(c=>tables.categories.some(row=>row.id===c.id)):[],
   settings:s.preferences?payload.settings:undefined,financialTables:tables,
   summary:{...payload.summary,totalTransactions:s.transactions?payload.transactions.length:0,totalBalance:s.accounts?payload.summary.totalBalance:0,totalIncome:s.transactions?payload.summary.totalIncome:0,totalExpenses:s.transactions?payload.summary.totalExpenses:0}};
}
export function mergeSelectedTables(current:FinancialSnapshot,payload:ExportDataPayload):FinancialSnapshot {
 const s=validateSelection(payload.selection),incoming=payload.financialTables;
 if(!incoming || FINANCIAL_TABLES.some(t=>!Array.isArray(incoming[t])) || Object.keys(incoming).length!==FINANCIAL_TABLES.length)throw Error('Incomplete selective backup.');
 for(const table of FINANCIAL_TABLES)if(!included(table,s)&&incoming[table].length)throw Error('Unselected section contains records.');
 const merged={} as FinancialSnapshot;
 for(const table of FINANCIAL_TABLES)merged[table]=(included(table,s)?incoming[table]:current[table]).map(row=>({...row}));
 // Keep categories/accounts required by sections that were not selected. A backup
 // cannot change the owner/provider/currency of an account with retained history.
 for(const table of ['categories','wallets'] as const) {
   const rows=new Map(current[table].map(r=>[r.id,{...r}]));
   for(const row of merged[table]) {
    const previous=rows.get(row.id);
    if(table==='wallets'&&previous&&!s.transactions) {
     if(current.transactions.some(t=>t.wallet_id===row.id)&&['provider_id','currency','account_number_last4'].some(k=>previous[k]!==row[k]))throw Error('Account identifiers conflict with existing history. Import into a new vault.');
     row.opening_balance=previous.opening_balance;row.balance=previous.balance;
    }
    rows.set(row.id,row);
   }
   merged[table]=[...rows.values()];
 }
 const preferred=(s.accounts?incoming.wallets:current.wallets).find(w=>w.is_default===1&&w.is_archived===0)?.id ?? merged.wallets.find(w=>w.is_archived===0)?.id;
 merged.wallets=merged.wallets.map(w=>({...w,is_default:w.id===preferred?1:0}));
 return merged;
}
