// frontend/constants/walletProviders.ts
// Typed wallet provider catalogue for BanKoni Ethiopian personal finance.
// Separates provider identity (catalogue service) from user wallet instances (SQLite records).

import { BANK_SVG_LOGOS } from './bankLogosSvg';

export type WalletProviderType = 'cash' | 'bank' | 'mobile_money' | 'custom';

export interface WalletProviderInfo {
    id: string;
    name: string;
    shortName: string;
    type: WalletProviderType;
    defaultCurrency: string;
    brandColor: string;
    monogram: string;
    svgXml?: string;
    description: string;
}

export const WALLET_PROVIDERS: WalletProviderInfo[] = [
    {
        id: 'cash',
        name: 'Physical Cash',
        shortName: 'Cash',
        type: 'cash',
        defaultCurrency: 'ETB',
        brandColor: '#10B981',
        monogram: 'CASH',
        description: 'Physical cash in hand or wallet',
    },
    {
        id: 'cbe',
        name: 'Commercial Bank of Ethiopia (CBE)',
        shortName: 'CBE',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#841774',
        monogram: 'CBE',
        svgXml: BANK_SVG_LOGOS.cbe,
        description: 'Ethiopia’s largest commercial bank',
    },
    {
        id: 'boa',
        name: 'Bank of Abyssinia (BOA)',
        shortName: 'BOA',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#B87333',
        monogram: 'BOA',
        svgXml: BANK_SVG_LOGOS.boa,
        description: 'Bank of Abyssinia retail account',
    },
    {
        id: 'dashen',
        name: 'Dashen Bank',
        shortName: 'Dashen',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#0B3B60',
        monogram: 'DSH',
        svgXml: BANK_SVG_LOGOS.dashen,
        description: 'Dashen Bank retail account',
    },
    {
        id: 'hibret',
        name: 'Hibret Bank',
        shortName: 'Hibret',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#E67300',
        monogram: 'HBR',
        svgXml: BANK_SVG_LOGOS.hibret,
        description: 'Hibret Bank retail account',
    },
    {
        id: 'cbe_birr',
        name: 'CBE Birr',
        shortName: 'CBE Birr',
        type: 'mobile_money',
        defaultCurrency: 'ETB',
        brandColor: '#9B287B',
        monogram: 'CB',
        svgXml: BANK_SVG_LOGOS.cbe_birr,
        description: 'Commercial Bank of Ethiopia mobile money',
    },
    {
        id: 'telebirr',
        name: 'Telebirr',
        shortName: 'Telebirr',
        type: 'mobile_money',
        defaultCurrency: 'ETB',
        brandColor: '#0172BB',
        monogram: 'TB',
        svgXml: BANK_SVG_LOGOS.telebirr,
        description: 'Ethio Telecom mobile wallet',
    },
    {
        id: 'mpesa',
        name: 'M-Pesa',
        shortName: 'M-Pesa',
        type: 'mobile_money',
        defaultCurrency: 'ETB',
        brandColor: '#43B02A',
        monogram: 'MP',
        // Logo pending from user - renders high-quality monogram badge with official green
        description: 'Safaricom Ethiopia mobile money',
    },
    {
        id: 'awash',
        name: 'Awash International Bank',
        shortName: 'Awash',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#005A9C',
        monogram: 'AWB',
        svgXml: BANK_SVG_LOGOS.awash,
        description: 'Awash International Bank account',
    },
    {
        id: 'coop',
        name: 'Cooperative Bank of Oromia',
        shortName: 'Coop',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#72246C',
        monogram: 'CBO',
        svgXml: BANK_SVG_LOGOS.coop,
        description: 'Cooperative Bank of Oromia account',
    },
    {
        id: 'ahadu',
        name: 'Ahadu Bank',
        shortName: 'Ahadu',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#0C3866',
        monogram: 'AHB',
        svgXml: BANK_SVG_LOGOS.ahadu,
        description: 'Ahadu Bank account',
    },
    {
        id: 'amhara',
        name: 'Amhara Bank',
        shortName: 'Amhara',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#C98A2C',
        monogram: 'AMB',
        svgXml: BANK_SVG_LOGOS.amhara,
        description: 'Amhara Bank account',
    },
    {
        id: 'zemen',
        name: 'Zemen Bank',
        shortName: 'Zemen',
        type: 'bank',
        defaultCurrency: 'ETB',
        brandColor: '#D51D4F',
        monogram: 'ZEM',
        svgXml: BANK_SVG_LOGOS.zemen,
        description: 'Zemen Bank account',
    },
    {
        id: 'custom',
        name: 'Custom / Other',
        shortName: 'Other',
        type: 'custom',
        defaultCurrency: 'ETB',
        brandColor: '#64748B',
        monogram: 'OTH',
        description: 'Any other bank, SACCO, or physical location',
    },
];

const PROVIDER_MAP = new Map<string, WalletProviderInfo>(
    WALLET_PROVIDERS.map((p) => [p.id, p]),
);

export function getWalletProvider(providerId?: string | null): WalletProviderInfo {
    if (!providerId) return PROVIDER_MAP.get('custom')!;
    return PROVIDER_MAP.get(providerId.toLowerCase()) ?? PROVIDER_MAP.get('custom')!;
}
