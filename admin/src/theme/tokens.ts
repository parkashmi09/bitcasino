/**
 * ccpayment console design tokens, read from the live console's CSS variables (console.ccpayment.com,
 * 24 Oct 2026; raw dump in inhouse/.refs/ccpayment/tokens.json). Light = the `style` on <html>, dark = `:root`.
 * The MUI theme (theme.ts) and the shadcn variables in globals.css both come from here, so a view's
 * Tailwind class and an MUI component show the same colour.
 */
export const tokens = {
  light: {
    text: '#1F2025',
    textSecondary: '#71757E',
    textDisabled: '#B3B9C5',
    stroke: '#E8ECF2',
    page: '#F8F9FB',
    paper: '#FFFFFF',
    neutral: '#E8ECF2',
    divider: 'rgba(113, 117, 126, 0.24)',
    hover: 'rgba(113, 117, 126, 0.08)',
    selected: 'rgba(113, 117, 126, 0.16)',
    inputBorder: '#B3B9C5',
    shadowCard: '0px 12px 24px 0px rgba(113, 117, 126, 0.16), 0px 0px 2px 0px rgba(113, 117, 126, 0.16)',
    shadowDropdown: '-20px 20px 40px 0px rgba(113, 117, 126, 0.16), 0px 0px 2px 0px rgba(113, 117, 126, 0.16)',
    shadowDialog: '0px 0px 2px 0px rgba(113, 117, 126, 0.16), -40px 40px 80px 4px rgba(113, 117, 126, 0.24)',
    info: '#65AEE8'
  },
  dark: {
    text: '#EBECF2',
    // ccpayment's #71757E is 3.6:1 on the dark paper; one grey step up keeps small text readable.
    textSecondary: '#A3A8B1',
    textDisabled: '#656872',
    stroke: '#383A3F',
    page: '#18181A',
    paper: '#1F2125',
    neutral: '#26282D',
    divider: 'rgba(113, 117, 126, 0.24)',
    hover: 'rgba(113, 117, 126, 0.08)',
    selected: 'rgba(113, 117, 126, 0.16)',
    inputBorder: '#494C54',
    shadowCard: '0px 12px 24px 0px rgba(0, 0, 0, 0.24), 0px 0px 2px 0px rgba(0, 0, 0, 0.24)',
    shadowDropdown: '-20px 20px 40px 0px rgba(0, 0, 0, 0.56), 0 0 2px 0 rgba(0, 0, 0, 0.24)',
    shadowDialog: '-40px 40px 80px 4px rgba(0, 0, 0, 0.56), 0px 0px 2px 0px rgba(0, 0, 0, 0.24)',
    info: '#65AEE8'
  },
  primary: { main: '#3C6FF5', light: '#89AFFC', lighter: '#D8E7FE', dark: '#1E3EB0', darker: '#0B1C75' },
  secondary: { main: '#BEE072', light: '#E3F5AD', dark: '#7AA139' },
  success: { main: '#43BE76', light: '#90EBA3', dark: '#218861' },
  warning: { main: '#E7B22B', light: '#FAE18B', dark: '#AC7C1F' },
  error: { main: '#EC684C', light: '#F9B593', dark: '#A92926' },
  grey: {
    100: '#F8F9FB',
    200: '#E8ECF2',
    300: '#CACFD8',
    400: '#A3A8B1',
    500: '#71757E',
    600: '#656872',
    700: '#494C54',
    800: '#383A3F',
    900: '#26282D'
  },
  font: 'var(--font-poppins), Poppins, sans-serif',
  radius: { control: 8, card: 16 },
  // MUI's standard curve and ccpayment's 250ms button/input transitions.
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  duration: 250
} as const
