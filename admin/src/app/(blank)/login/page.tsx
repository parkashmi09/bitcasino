import { Suspense } from 'react'

import Login from '@/views/auth/Login'

export const metadata = { title: 'Sign in' }

const LoginPage = () => (
  <Suspense>
    <Login />
  </Suspense>
)

export default LoginPage
