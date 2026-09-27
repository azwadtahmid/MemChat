import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { MotionConfig } from 'motion/react'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Under prefers-reduced-motion, Motion drops transforms and keeps opacity fades. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
