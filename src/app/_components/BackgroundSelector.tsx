'use client';

import { useEffect, useState } from 'react';
import CyberneticGridShader from './ShaderAnimation';
import Starfield from './Starfield';
import AntiGravityBackground from './AntiGravityBackground';
import { GridHeroBackground } from './GridHeroBackground';
import { PrismaVideoBackground } from './PrismaVideoBackground';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
	const [currentIndex, setCurrentIndex] = useState(0);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		// Load saved background preference
		const saved = localStorage.getItem('backgroundIndex');
		if (saved) {
			setCurrentIndex(parseInt(saved, 10));
		} else {
			// Random on first visit
			setCurrentIndex(Math.floor(Math.random() * BACKGROUNDS.length));
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
			<div className="fixed left-6 z-50 flex items-center gap-2 rounded-lg border border-slate-300 bg-white/90 px-3 py-2 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 top-20 md:top-auto md:bottom-6">
				<button
					onClick={handlePrev}
					className="rounded p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
					aria-label="Previous background"
					title="Previous background"
				>
					<ChevronLeft className="h-4 w-4 text-slate-700 dark:text-slate-300" />
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
					<ChevronRight className="h-4 w-4 text-slate-700 dark:text-slate-300" />
				</button>
			</div>
		</>
	);
}
