import { createRoot } from 'react-dom/client'
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/500.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/open-sans/400-italic.css'
import './styles/theme.css'
import './styles/app.css'
import './styles/extras.css'
import './styles/detail.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
