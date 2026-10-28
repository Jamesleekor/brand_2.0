import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@/App'
import { ToastContainer } from '@/stores/ui_store'
import '@/styles/globals.css'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
})

queryClient.setQueryDefaults(['guild3-teacher-detail'], {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  refetchOnReconnect: 'always',
})

queryClient.setQueryDefaults(['guild2-admin'], {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  refetchOnReconnect: 'always',
})

if (Capacitor.getPlatform() === 'android') {
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const currentPath =
      window.location.hash.slice(1).split('?')[0] || '/'

    const isHomeScreen = [
      '/',
      '/home',
      '/teacher',
      '/login',
    ].includes(currentPath)

    if (isHomeScreen) {
      void CapacitorApp.minimizeApp()
    } else if (canGoBack) {
      window.history.back()
    } else {
      window.location.hash = currentPath.startsWith('/teacher')
        ? '/teacher'
        : '/home'
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <ToastContainer />
      </QueryClientProvider>
    </HashRouter>
  </React.StrictMode>,
)
