"use client"

import { useEffect, useRef } from "react"
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { IsometricScene } from "./isometric-scene"
import { ArrowRight, Play } from "lucide-react"
import { Button } from "@/components/ui/button"

// Magnetic floating stat card with parallax
function FloatingStatCard({
  position,
  label,
  value,
  subtext,
  color,
  delay,
}: {
  position: "top-left" | "bottom-right"
  label: string
  value: string
  subtext: string
  color: "teal" | "coral"
  delay: number
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  const springConfig = { damping: 30, stiffness: 150 }
  const x = useSpring(mouseX, springConfig)
  const y = useSpring(mouseY, springConfig)

  // Inverse parallax - cards drift opposite to cursor
  const cardX = useTransform(x, [-200, 200], [15, -15])
  const cardY = useTransform(y, [-200, 200], [10, -10])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      mouseX.set(e.clientX - centerX)
      mouseY.set(e.clientY - centerY)
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [mouseX, mouseY])

  const positionClasses = {
    "top-left": "top-10 -left-4 lg:left-0",
    "bottom-right": "bottom-20 -right-4 lg:right-0",
  }

  const colorClasses = {
    teal: "text-teal",
    coral: "text-coral",
  }

  return (
    <motion.div
      ref={cardRef}
      className={`absolute ${positionClasses[position]} bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-4 shadow-lg shadow-foreground/5`}
      initial={{ opacity: 0, x: position === "top-left" ? -30 : 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.6, type: "spring", stiffness: 100 }}
      style={{ x: cardX, y: cardY }}
    >
      {/* Sine wave bobbing */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: position === "top-left" ? 0 : 0.5,
        }}
      >
        <div className="text-xs text-muted-foreground mb-1 font-medium tracking-wide uppercase">
          {label}
        </div>
        <div className={`text-2xl font-bold ${colorClasses[color]} tracking-tight`}>
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{subtext}</div>
      </motion.div>
    </motion.div>
  )
}

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-background">
      {/* Ultra-thin dotted grid with radial mask */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 50% 50%, transparent 0%, hsl(210 20% 98%) 70%),
            radial-gradient(circle, hsl(226 23% 88% / 0.08) 0.5px, transparent 0.5px)
          `,
          backgroundSize: "100% 100%, 40px 40px",
        }}
      />

      <div className="container mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-5 gap-12 lg:gap-8 items-center min-h-screen py-20">
          {/* Left content - 2 columns */}
          <div className="lg:col-span-2 space-y-8 relative z-10">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal/10 text-teal border border-teal/20 text-sm font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
                </span>
                Now in Public Beta
              </span>
            </motion.div>

            {/* Headline with tighter letter-spacing */}
            <motion.h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[1.1] text-balance"
              style={{ letterSpacing: "-0.05em" }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              Build your data{" "}
              <span className="relative inline-block">
                {/* Gradient text with glow */}
                <span
                  className="relative z-10 bg-gradient-to-r from-teal to-cyan-400 bg-clip-text text-transparent"
                  style={{
                    textShadow: "0 0 40px hsl(174 62% 56% / 0.3)",
                  }}
                >
                  infrastructure
                </span>
                {/* Underline highlight */}
                <motion.span
                  className="absolute bottom-1 left-0 h-3 w-full bg-gradient-to-r from-teal/20 to-cyan-400/20 -z-0 rounded-sm"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.5, delay: 0.8 }}
                  style={{ originX: 0 }}
                />
              </span>{" "}
              with confidence
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              Deploy real-time analytics pipelines in minutes. Scale effortlessly
              with enterprise-grade security and seamless integrations.
            </motion.p>

            {/* CTAs */}
            <motion.div
              className="flex flex-col sm:flex-row gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <Button
                size="lg"
                className="bg-foreground text-background hover:bg-foreground/90 group px-8 shadow-lg shadow-foreground/10 transition-all hover:shadow-xl hover:shadow-foreground/15"
              >
                Start Building
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-border hover:bg-muted group bg-transparent transition-all hover:border-teal/30"
              >
                <Play className="mr-2 h-4 w-4" />
                Watch Demo
              </Button>
            </motion.div>

            {/* Social proof */}
            <motion.div
              className="flex items-center gap-6 pt-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              <div className="flex -space-x-2">
                {[
                  "bg-coral",
                  "bg-teal",
                  "bg-gold",
                  "bg-foreground",
                ].map((color, i) => (
                  <motion.div
                    key={i}
                    className={`w-8 h-8 rounded-full ${color} border-2 border-background flex items-center justify-center text-xs font-medium text-background shadow-sm`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.1, type: "spring" }}
                  >
                    {String.fromCharCode(65 + i)}
                  </motion.div>
                ))}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">2,400+</span>{" "}
                teams building
              </div>
            </motion.div>
          </div>

          {/* Right content - Isometric Scene - 3 columns */}
          <motion.div
            className="lg:col-span-3 relative"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="relative aspect-square max-w-[600px] mx-auto">
              <IsometricScene />

              {/* Magnetic Floating stat cards with parallax */}
              <FloatingStatCard
                position="top-left"
                label="Processing"
                value="2.4M"
                subtext="events/sec"
                color="teal"
                delay={1.5}
              />

              <FloatingStatCard
                position="bottom-right"
                label="Uptime"
                value="99.99%"
                subtext="guaranteed"
                color="coral"
                delay={1.8}
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  )
}
