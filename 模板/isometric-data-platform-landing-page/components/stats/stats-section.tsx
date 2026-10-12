"use client"

import { motion, useInView } from "framer-motion"
import { useRef, useEffect, useState } from "react"

const stats = [
  { value: 2.4, suffix: "M+", label: "Events processed daily", color: "teal" },
  { value: 99.99, suffix: "%", label: "Uptime guarantee", color: "coral" },
  { value: 150, suffix: "+", label: "Enterprise customers", color: "gold" },
  { value: 40, suffix: "+", label: "Global edge regions", color: "teal" },
]

function AnimatedCounter({ 
  value, 
  suffix, 
  isInView 
}: { 
  value: number
  suffix: string
  isInView: boolean 
}) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!isInView) return

    const duration = 2000
    const steps = 60
    const increment = value / steps
    let current = 0

    const timer = setInterval(() => {
      current += increment
      if (current >= value) {
        setCount(value)
        clearInterval(timer)
      } else {
        setCount(current)
      }
    }, duration / steps)

    return () => clearInterval(timer)
  }, [isInView, value])

  const displayValue = value >= 100 
    ? Math.round(count) 
    : count.toFixed(value % 1 !== 0 ? 2 : 0)

  return (
    <span>
      {displayValue}{suffix}
    </span>
  )
}

export function StatsSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="py-20 bg-foreground relative overflow-hidden">
      {/* Background pattern */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="container mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="text-center"
            >
              <div 
                className={`text-4xl md:text-5xl lg:text-6xl font-bold mb-2 ${
                  stat.color === "teal" ? "text-teal" : 
                  stat.color === "coral" ? "text-coral" : 
                  "text-gold"
                }`}
              >
                <AnimatedCounter 
                  value={stat.value} 
                  suffix={stat.suffix} 
                  isInView={isInView} 
                />
              </div>
              <div className="text-background/70 text-sm md:text-base">
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
