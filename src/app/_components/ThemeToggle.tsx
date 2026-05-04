'use client';

import { useTheme } from './ThemeProvider';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
	const { isDark, toggleTheme, mounted } = useTheme();

	if (!mounted) {
		return null;
	}

	return (
		<button
			onClick={toggleTheme}
			className="fixed top-6 right-6 z-50 rounded-lg border border-slate-300 bg-white p-2.5 shadow-md transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
			aria-label="Toggle theme"
			title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
		>
			{isDark ? (
				<Sun className="h-5 w-5 text-yellow-500" />
			) : (
				<Moon className="h-5 w-5 text-slate-700" />
			)}
		</button>
	);
}
