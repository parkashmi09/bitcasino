'use client'

import { createTheme } from '@mui/material/styles'

import { tokens as t } from './tokens'

const scheme = (mode: 'light' | 'dark') => {
  const m = t[mode]

  return {
    palette: {
      primary: { main: t.primary.main, light: t.primary.light, dark: t.primary.dark, contrastText: '#FFFFFF' },
      secondary: { main: t.secondary.main, light: t.secondary.light, dark: t.secondary.dark, contrastText: '#1F2025' },
      success: { main: t.success.main, light: t.success.light, dark: t.success.dark, contrastText: '#FFFFFF' },
      warning: { main: t.warning.main, light: t.warning.light, dark: t.warning.dark, contrastText: '#1F2025' },
      error: { main: t.error.main, light: t.error.light, dark: t.error.dark, contrastText: '#FFFFFF' },
      info: { main: m.info, contrastText: '#FFFFFF' },
      grey: t.grey,
      text: { primary: m.text, secondary: m.textSecondary, disabled: m.textDisabled },
      background: { default: m.page, paper: m.paper },
      divider: m.divider,
      action: { hover: m.hover, selected: m.selected, focus: m.selected, hoverOpacity: 0.08, disabledOpacity: 0.48 }
    }
  }
}

// `colorSchemeSelector: 'class'` matches next-themes, which puts `light`/`dark` on <html>.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class', cssVarPrefix: 'mui' },
  colorSchemes: { light: scheme('light'), dark: scheme('dark') },
  shape: { borderRadius: t.radius.control },
  typography: {
    fontFamily: t.font,
    button: { textTransform: 'capitalize', fontWeight: 600 }
  },
  transitions: {
    easing: { easeInOut: t.easing },
    duration: { standard: t.duration, short: t.duration }
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: t.radius.control } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: t.radius.card } } },
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: t.radius.card,
          boxShadow: t.light.shadowCard,
          ...theme.applyStyles('dark', { boxShadow: t.dark.shadowCard })
        })
      }
    },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: t.radius.control } } },
    MuiTooltip: { styleOverrides: { tooltip: { fontFamily: t.font, borderRadius: 6 } } }
  }
})
