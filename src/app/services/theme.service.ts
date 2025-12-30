import { Injectable, signal, effect } from '@angular/core';
import { DEFAULT_THEMES } from '../models/desktop.model';

export interface ThemeColors {
  name: string;
  primary: string;
  rgb: string;
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {

  readonly availableThemes: ThemeColors[] = [
    { name: 'Cyber Green', primary: '#0d7337', rgb: '13, 115, 55' },
    { name: 'Matrix', primary: '#00ff41', rgb: '0, 255, 65' },
    { name: 'Neon Blue', primary: '#00d4ff', rgb: '0, 212, 255' },
    { name: 'Neon Red', primary: '#ff0040', rgb: '255, 0, 64' },
    { name: 'Neon Purple', primary: '#bf00ff', rgb: '191, 0, 255' },
    { name: 'Neon Orange', primary: '#ff6600', rgb: '255, 102, 0' },
    { name: 'Ice White', primary: '#e0ffff', rgb: '224, 255, 255' },
    { name: 'Gold', primary: '#ffd700', rgb: '255, 215, 0' },
    { name: 'Cyber Pink', primary: '#ff1493', rgb: '255, 20, 147' },
    { name: 'Toxic Green', primary: '#39ff14', rgb: '57, 255, 20' }
  ];

  readonly currentTheme = signal<ThemeColors>(this.availableThemes[0]);
  readonly glowIntensity = signal<number>(0.7);
  readonly particlesEnabled = signal<boolean>(true);
  readonly animationsEnabled = signal<boolean>(true);

  constructor() {
    // Aplicar tema inicial
    effect(() => {
      this.applyTheme(this.currentTheme());
    });

    effect(() => {
      this.applyGlowIntensity(this.glowIntensity());
    });
  }

  setTheme(theme: ThemeColors): void {
    this.currentTheme.set(theme);
  }

  setThemeByName(name: string): void {
    const theme = this.availableThemes.find(t => t.name === name);
    if (theme) {
      this.currentTheme.set(theme);
    }
  }

  setThemeByColor(color: string): void {
    const theme = this.availableThemes.find(t => t.primary === color);
    if (theme) {
      this.currentTheme.set(theme);
    } else {
      // Si no existe, crear uno personalizado
      const rgb = this.hexToRgb(color);
      this.currentTheme.set({
        name: 'Custom',
        primary: color,
        rgb: `${rgb.r}, ${rgb.g}, ${rgb.b}`
      });
    }
  }

  setGlowIntensity(intensity: number): void {
    this.glowIntensity.set(Math.max(0, Math.min(1, intensity)));
  }

  toggleParticles(): void {
    this.particlesEnabled.update(v => !v);
  }

  toggleAnimations(): void {
    this.animationsEnabled.update(v => !v);
  }

  private applyTheme(theme: ThemeColors): void {
    document.documentElement.style.setProperty('--primary-color', theme.primary);
    document.documentElement.style.setProperty('--primary-rgb', theme.rgb);
  }

  private applyGlowIntensity(intensity: number): void {
    document.documentElement.style.setProperty('--glow-intensity', intensity.toString());
  }

  private hexToRgb(hex: string): { r: number, g: number, b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  // Obtener contraste para texto sobre el color primario
  getContrastColor(hexColor: string): string {
    const rgb = this.hexToRgb(hexColor);
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }
}
