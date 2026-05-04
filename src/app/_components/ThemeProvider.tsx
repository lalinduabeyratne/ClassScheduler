'use client';

import { useEffect, useState } from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		// Check for saved theme preference or system preference
		const savedTheme = localStorage.getItem('theme');
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const isDark = savedTheme === 'dark' || (savedTheme === null && prefersDark);

		if (isDark) {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
	}, []);

	if (!mounted) {
		return <>{children}</>;
	}

	return <>{children}</>;
}

export function useTheme() {
	const [isDark, setIsDark] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		setIsDark(document.documentElement.classList.contains('dark'));
	}, []);

	const toggleTheme = () => {
		const newIsDark = !isDark;
		if (newIsDark) {
			document.documentElement.classList.add('dark');
			localStorage.setItem('theme', 'dark');
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.setItem('theme', 'light');
		}
		setIsDark(newIsDark);
	};

	return { isDark, toggleTheme, mounted };
}
