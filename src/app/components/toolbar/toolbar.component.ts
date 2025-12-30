import { Component, Output, EventEmitter, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService, ThemeColors } from '../../services/theme.service';
import { Desktop } from '../../models/desktop.model';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent {
  @Input() breadcrumb: Desktop[] = [];
  @Output() addNote = new EventEmitter<void>();
  @Output() addFolder = new EventEmitter<void>();
  @Output() navigateTo = new EventEmitter<string>();
  @Output() exportData = new EventEmitter<void>();
  @Output() importData = new EventEmitter<void>();
  @Output() toggleStructure = new EventEmitter<void>();

  showThemePicker = signal(false);
  showMenu = signal(false);

  constructor(public themeService: ThemeService) {}

  get themes() {
    return this.themeService.availableThemes;
  }

  get currentTheme() {
    return this.themeService.currentTheme();
  }

  get glowIntensity() {
    return this.themeService.glowIntensity();
  }

  selectTheme(theme: ThemeColors): void {
    this.themeService.setTheme(theme);
  }

  setGlowIntensity(value: number): void {
    this.themeService.setGlowIntensity(value);
  }

  onNavigate(desktopId: string): void {
    this.navigateTo.emit(desktopId);
  }

  toggleMenu(): void {
    this.showMenu.update(v => !v);
    if (this.showMenu()) {
      this.showThemePicker.set(false);
    }
  }

  toggleThemePicker(): void {
    this.showThemePicker.update(v => !v);
    if (this.showThemePicker()) {
      this.showMenu.set(false);
    }
  }

  onExport(): void {
    this.showMenu.set(false);
    this.exportData.emit();
  }

  onImport(): void {
    this.showMenu.set(false);
    this.importData.emit();
  }

  onToggleStructure(): void {
    this.showMenu.set(false);
    this.toggleStructure.emit();
  }
}
