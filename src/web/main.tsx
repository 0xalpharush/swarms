import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './style.css'
import './research.css'
import './room.css'

function fit() {
  document.documentElement.style.setProperty('--screen', `${Math.round(visualViewport?.height ?? innerHeight)}px`)
  if (scrollY) scrollTo(0, 0)
}

fit()
visualViewport?.addEventListener('resize', fit)
visualViewport?.addEventListener('scroll', fit)
addEventListener('resize', fit)

createRoot(document.getElementById('root')!).render(<App />)
