'use client';

import { useEffect, useState } from 'react';
import CyberneticGridShader from './ShaderAnimation';
import Starfield from './Starfield';
import AntiGravityBackground from './AntiGravityBackground';
import { GridHeroBackground } from './GridHeroBackground';
import { PrismaVideoBackground } from './PrismaVideoBackground';

function IconChevronLeft(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
			<polyline points="15 18 9 12 15 6" />
		</svg>
	);
}

function IconChevronRight(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
			<polyline points="9 18 15 12 9 6" />
		</svg>
	);
}

type BackgroundType = 'shader' | 'starfield' | 'antigravity' | 'gridhero' | 'prisma';

const BACKGROUNDS: BackgroundType[] = ['shader', 'starfield', 'antigravity', 'gridhero', 'prisma'];
const BACKGROUND_NAMES: Record<BackgroundType, string> = {
	shader: 'Cybernetic Grid',
	starfield: 'Starfield',
	antigravity: 'Anti-Gravity',
	gridhero: 'Grid Hero',
	prisma: 'Prisma Video',
};

export function BackgroundSelector() {
	const [currentIndex, setCurrentIndex] = useState(4); // Default to Prisma (index 4)
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		// Load saved background preference
		const saved = localStorage.getItem('backgroundIndex');
		if (saved) {
			setCurrentIndex(parseInt(saved, 10));
		} else {
			// Default to Prisma on first visit
			setCurrentIndex(4);
		}
	}, []);

	const currentBg = BACKGROUNDS[currentIndex];

	const handleNext = () => {
		const newIndex = (currentIndex + 1) % BACKGROUNDS.length;
		setCurrentIndex(newIndex);
		localStorage.setItem('backgroundIndex', newIndex.toString());
	};

	const handlePrev = () => {
		const newIndex = (currentIndex - 1 + BACKGROUNDS.length) % BACKGROUNDS.length;
		setCurrentIndex(newIndex);
		localStorage.setItem('backgroundIndex', newIndex.toString());
	};

	if (!mounted) {
		return null;
	}

	return (
		<>
			{/* Background */}
			{currentBg === 'shader' && <CyberneticGridShader />}
			{currentBg === 'starfield' && (
				<Starfield
					starColor="rgba(255,255,255,0.8)"
					bgColor="rgba(0,0,0,1)"
					mouseAdjust={true}
					speed={0.5}
					quantity={256}
				/>
			)}
			{currentBg === 'antigravity' && <AntiGravityBackground />}
			{currentBg === 'gridhero' && <GridHeroBackground />}
			{currentBg === 'prisma' && <PrismaVideoBackground />}

			{/* Background Toggle Controls - Bottom on desktop, top on mobile */}
			<div className="glass-surface fixed left-6 top-20 z-50 flex items-center gap-2 px-3 py-2 md:top-auto md:bottom-6">
				<button
					onClick={handlePrev}
					className="rounded p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
					aria-label="Previous background"
					title="Previous background"
				>
					<IconChevronLeft className="h-4 w-4 text-slate-700 dark:text-slate-300" />
				</button>

				<span className="min-w-32 text-center text-sm font-medium text-slate-700 dark:text-slate-300">
					{BACKGROUND_NAMES[currentBg]}
				</span>

				<button
					onClick={handleNext}
					className="rounded p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
					aria-label="Next background"
					title="Next background"
				>
					<IconChevronRight className="h-4 w-4 text-slate-700 dark:text-slate-300" />
				</button>
			</div>
		</>
	);
}
