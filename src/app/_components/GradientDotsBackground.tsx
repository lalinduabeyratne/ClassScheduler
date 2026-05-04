'use client';

import React from 'react';
import { motion } from 'framer-motion';

type GradientDotsProps = React.ComponentProps<typeof motion.div> & {
	/** Dot size (default: 12) */
	dotSize?: number;
	/** Spacing between dots (default: 20) */
	spacing?: number;
	/** Animation duration (default: 20) */
	duration?: number;
	/** Color cycle duration (default: 8) */
	colorCycleDuration?: number;
	/** Background color (default: 'rgba(10, 10, 20, 1)') */
	backgroundColor?: string;
};

export function GradientDots({
	dotSize = 12,
	spacing = 20,
	duration = 20,
	colorCycleDuration = 8,
	backgroundColor = 'rgba(10, 10, 20, 1)',
	className,
	...props
}: GradientDotsProps) {
	const hexSpacing = spacing * 1.732; // Hexagonal spacing calculation

	return (
		<motion.div
			className={`absolute inset-0 ${className}`}
			style={{
				backgroundColor,
				backgroundImage: `
					radial-gradient(circle, #ff1493 0%, #ff1493 ${dotSize}px, transparent ${dotSize + 2}px),
					radial-gradient(circle, #00d4ff 0%, #00d4ff ${dotSize}px, transparent ${dotSize + 2}px),
					radial-gradient(circle, #00ff88 0%, #00ff88 ${dotSize}px, transparent ${dotSize + 2}px),
					radial-gradient(circle, #ffd700 0%, #ffd700 ${dotSize}px, transparent ${dotSize + 2}px),
					radial-gradient(circle, #9d4edd 0%, #9d4edd ${dotSize}px, transparent ${dotSize + 2}px),
					radial-gradient(circle, #ff006e 0%, #ff006e ${dotSize}px, transparent ${dotSize + 2}px)
				`,
				backgroundSize: `
					${spacing * 2}px ${hexSpacing * 2}px,
					${spacing * 2}px ${hexSpacing * 2}px,
					${spacing * 2}px ${hexSpacing * 2}px,
					${spacing * 2}px ${hexSpacing * 2}px,
					${spacing * 2}px ${hexSpacing * 2}px,
					${spacing * 2}px ${hexSpacing * 2}px
				`,
				backgroundPosition: `
					0px 0px,
					${spacing}px ${hexSpacing / 2}px,
					${spacing * 0.5}px ${hexSpacing * 1.5}px,
					${spacing * 1.5}px ${hexSpacing * 1.5}px,
					${spacing * 1.5}px ${hexSpacing * 0.5}px,
					${spacing * 0.5}px ${hexSpacing * 0.5}px
				`,
				backgroundRepeat: 'repeat',
			}}
			animate={{
				backgroundPosition: [
					`0px 0px, ${spacing}px ${hexSpacing / 2}px, ${spacing * 0.5}px ${hexSpacing * 1.5}px, ${spacing * 1.5}px ${hexSpacing * 1.5}px, ${spacing * 1.5}px ${hexSpacing * 0.5}px, ${spacing * 0.5}px ${hexSpacing * 0.5}px`,
					`${spacing}px ${hexSpacing}px, ${spacing * 2}px ${hexSpacing * 1.5}px, ${spacing * 1.5}px ${hexSpacing * 2.5}px, ${spacing * 2.5}px ${hexSpacing * 2.5}px, ${spacing * 2.5}px ${hexSpacing * 1.5}px, ${spacing * 1.5}px ${hexSpacing * 1.5}px`,
				],
				filter: ['hue-rotate(0deg)', 'hue-rotate(360deg)'],
			}}
			transition={{
				backgroundPosition: {
					duration: duration,
					ease: 'linear',
					repeat: Number.POSITIVE_INFINITY,
				},
				filter: {
					duration: colorCycleDuration,
					ease: 'linear',
					repeat: Number.POSITIVE_INFINITY,
				},
			}}
			{...props}
		/>
	);
}

export default function GradientDotsBackground() {
	return (
		<GradientDots
			dotSize={12}
			spacing={20}
			duration={20}
			colorCycleDuration={8}
			backgroundColor="rgba(10, 10, 20, 1)"
		/>
	);
}
