'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

type BackgroundSelectorContextValue = {
	currentBg: BackgroundType;
	currentBgName: string;
	handleNext: () => void;
	handlePrev: () => void;
	mounted: boolean;
};

const BackgroundSelectorContext = createContext<BackgroundSelectorContextValue | null>(null);

function useBackgroundSelectorContext() {
	const value = useContext(BackgroundSelectorContext);

	if (!value) {
		throw new Error('BackgroundSelector controls must be used within BackgroundSelectorProvider');
	}

	return value;
}

export function BackgroundSelectorProvider({ children }: { children: React.ReactNode }) {
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

	const handleNext = useCallback(() => {
		setCurrentIndex((current) => {
			const newIndex = (current + 1) % BACKGROUNDS.length;
			localStorage.setItem('backgroundIndex', newIndex.toString());
			return newIndex;
		});
	}, []);

	const handlePrev = useCallback(() => {
		setCurrentIndex((current) => {
			const newIndex = (current - 1 + BACKGROUNDS.length) % BACKGROUNDS.length;
			localStorage.setItem('backgroundIndex', newIndex.toString());
			return newIndex;
		});
	}, []);

	const value = useMemo(
		() => ({
			currentBg,
			currentBgName: BACKGROUND_NAMES[currentBg],
			handleNext,
			handlePrev,
			mounted,
		}),
		[currentBg, handleNext, handlePrev, mounted],
	);

	return <BackgroundSelectorContext.Provider value={value}>{children}</BackgroundSelectorContext.Provider>;
}

export function BackgroundLayer() {
	const { currentBg, mounted } = useBackgroundSelectorContext();

	if (!mounted) {
		return null;
	}

	return (
		<>
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
		</>
	);
}

export function BackgroundControls({ variant }: { variant: 'desktop' | 'mobile' }) {
	const { currentBg, currentBgName, handleNext, handlePrev, mounted } = useBackgroundSelectorContext();

	if (!mounted) {
		return null;
	}

	if (variant === 'mobile') {
		return (
			<button
				onClick={handleNext}
				className="glass-surface inline-flex max-w-[16rem] items-center gap-2 px-3 py-3 md:hidden"
				aria-label="Change background"
				title={`Change background: ${currentBgName}`}
			>
				<IconChevronRight className="h-5 w-5 shrink-0 text-slate-700 dark:text-slate-200" />
				<span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
					{currentBgName}
				</span>
			</button>
		);
	}

	return (
		<div className="glass-surface fixed left-6 top-48 z-50 hidden items-center gap-2 px-3 py-2 md:flex md:top-auto md:bottom-6">
			<button
				onClick={handlePrev}
				className="rounded p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
				aria-label="Previous background"
				title="Previous background"
			>
				<IconChevronLeft className="h-4 w-4 text-slate-700 dark:text-slate-300" />
			</button>

			<span className="min-w-32 text-center text-sm font-medium text-slate-700 dark:text-slate-300">
				{currentBgName}
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
	);
}

export function BackgroundSelector() {
	return null;
}
