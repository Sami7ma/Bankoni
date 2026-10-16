# BanKoni Bundled Wallet Assets

This directory is reserved for bundled static raster images (PNG, JPG, WebP) for wallet providers.

## Asset Architecture

BanKoni uses a hybrid asset architecture:
1. **SVG Vector Logos**: Stored as clean vector assets (from `assets/BankIcons/` and embedded via `constants/bankLogosSvg.ts`), rendered crisp at any resolution using `react-native-svg`'s `<SvgXml>`.
2. **Bundled Static Raster Images**: When PNG/JPG assets are added to this folder, they can be statically imported and bundled by Metro via `require('./assets/wallets/<filename>.png')`.
3. **Monogram & Icon Fallbacks**: For providers without a dedicated logo (such as physical Cash, M-Pesa pending logo, or Custom bank accounts), BanKoni renders a high-fidelity monogram badge with official brand accent colors and Lucide icons.

## Expected Asset Names (if providing raster logos):

| Provider | Expected Filename | Current Status |
|---|---|---|
| Commercial Bank of Ethiopia (CBE) | `cbe.png` | SVG available (`assets/BankIcons/Commercial Bank of Ethiopia Logo.svg`) |
| Bank of Abyssinia (BOA) | `boa.png` | SVG available (`assets/BankIcons/Bank of Abyssinia Logo.svg`) |
| Dashen Bank | `dashen.png` | SVG available (`assets/BankIcons/Dashen Bank Logo.svg`) |
| Hibret Bank | `hibret.png` | SVG available (`assets/BankIcons/Hibret Bank  Logo.svg`) |
| CBE Birr | `cbe_birr.png` | SVG available (`assets/BankIcons/CBE Birr Logo.svg`) |
| Telebirr | `telebirr.png` | SVG available (`assets/BankIcons/TeleBirr Logo.svg`) |
| M-Pesa | `mpesa.png` | **Needed from user** (Fallback monogram "MP" active) |
| Physical Cash | `cash.png` | Lucide `Banknote` icon |
| Custom / Other | `custom.png` | Lucide `WalletCards` icon |
| Awash International Bank | `awash.png` | SVG available |
| Cooperative Bank of Oromia | `coop.png` | SVG available |
| Ahadu Bank | `ahadu.png` | SVG available |
| Amhara Bank | `amhara.png` | SVG available |
| Zemen Bank | `zemen.png` | SVG available |

> **Note**: Database records only store the stable `provider_id` string (e.g. `'cbe'`, `'telebirr'`). No image blobs are stored in SQLite.
