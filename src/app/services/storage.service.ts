import { Injectable, signal, computed } from '@angular/core';
import {
  AppState,
  Desktop,
  Note,
  Folder,
  Connection,
  ThemeConfig,
  createDefaultDesktop,
  createDefaultNote,
  createDefaultFolder,
  DEFAULT_THEMES
} from '../models/desktop.model';

const STORAGE_KEY = 'multidesktop_data';
const ROOT_DESKTOP_ID = 'root';

@Injectable({
  providedIn: 'root'
})
export class StorageService {

  private state = signal<AppState>(this.loadState());

  // Computed signals
  readonly appState = computed(() => this.state());
  readonly currentDesktop = computed(() => {
    const state = this.state();
    return state.desktops.find(d => d.id === state.currentDesktopId) || state.desktops[0];
  });
  readonly theme = computed(() => this.state().theme);
  readonly desktops = computed(() => this.state().desktops);

  // Navegación - obtener ruta de breadcrumb
  readonly breadcrumbPath = computed(() => {
    const state = this.state();
    const path: Desktop[] = [];
    let current = this.currentDesktop();

    while (current) {
      path.unshift(current);
      if (current.parentId) {
        current = state.desktops.find(d => d.id === current!.parentId)!;
      } else {
        break;
      }
    }
    return path;
  });

  constructor() {
    // Auto-save on state changes
    this.saveState();
  }

  private loadState(): AppState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restaurar fechas
        parsed.desktops.forEach((d: Desktop) => {
          d.createdAt = new Date(d.createdAt);
          d.notes.forEach((n: Note) => {
            n.createdAt = new Date(n.createdAt);
            n.updatedAt = new Date(n.updatedAt);
          });
        });
        return parsed;
      }
    } catch (e) {
      console.error('Error loading state:', e);
    }

    // Estado inicial por defecto
    return {
      desktops: [createDefaultDesktop(ROOT_DESKTOP_ID, 'Escritorio Principal')],
      currentDesktopId: ROOT_DESKTOP_ID,
      theme: {
        primaryColor: DEFAULT_THEMES['cyber-green'],
        glowIntensity: 0.7,
        particlesEnabled: true,
        animationsEnabled: true
      }
    };
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch (e) {
      console.error('Error saving state:', e);
    }
  }

  private updateState(updater: (state: AppState) => AppState): void {
    this.state.update(state => {
      const newState = updater(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      return newState;
    });
  }

  // ==================== NAVEGACIÓN ====================

  navigateToDesktop(desktopId: string): void {
    this.updateState(state => ({
      ...state,
      currentDesktopId: desktopId
    }));
  }

  navigateToParent(): void {
    const current = this.currentDesktop();
    if (current?.parentId) {
      this.navigateToDesktop(current.parentId);
    }
  }

  // ==================== NOTAS ====================

  addNote(position: { x: number, y: number }): Note {
    const id = this.generateId();
    const note = createDefaultNote(id, position);
    const maxZ = this.getMaxZIndex();
    note.zIndex = maxZ + 1;

    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? { ...d, notes: [...d.notes, note] }
          : d
      )
    }));

    return note;
  }

  updateNote(noteId: string, updates: Partial<Note>): void {
    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? {
              ...d,
              notes: d.notes.map(n =>
                n.id === noteId
                  ? { ...n, ...updates, updatedAt: new Date() }
                  : n
              )
            }
          : d
      )
    }));
  }

  deleteNote(noteId: string): void {
    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? {
              ...d,
              notes: d.notes.filter(n => n.id !== noteId),
              connections: d.connections.filter(c =>
                c.fromNoteId !== noteId && c.toNoteId !== noteId
              )
            }
          : d
      )
    }));
  }

  bringNoteToFront(noteId: string): void {
    const maxZ = this.getMaxZIndex();
    this.updateNote(noteId, { zIndex: maxZ + 1 });
  }

  private getMaxZIndex(): number {
    const notes = this.currentDesktop()?.notes || [];
    return notes.reduce((max, n) => Math.max(max, n.zIndex), 0);
  }

  // ==================== CARPETAS ====================

  addFolder(name: string, position: { x: number, y: number }): Folder {
    const folderId = this.generateId();
    const desktopId = this.generateId();

    // Crear el escritorio hijo
    const newDesktop = createDefaultDesktop(
      desktopId,
      name,
      this.state().currentDesktopId
    );

    // Crear la carpeta
    const folder = createDefaultFolder(folderId, name, position, desktopId);

    this.updateState(state => ({
      ...state,
      desktops: [
        ...state.desktops.map(d =>
          d.id === state.currentDesktopId
            ? { ...d, folders: [...d.folders, folder] }
            : d
        ),
        newDesktop
      ]
    }));

    return folder;
  }

  updateFolder(folderId: string, updates: Partial<Folder>): void {
    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? {
              ...d,
              folders: d.folders.map(f =>
                f.id === folderId ? { ...f, ...updates } : f
              )
            }
          : d
      )
    }));
  }

  deleteFolder(folderId: string): void {
    const folder = this.currentDesktop()?.folders.find(f => f.id === folderId);
    if (!folder) return;

    // Eliminar recursivamente el escritorio y sus hijos
    const desktopIdsToDelete = this.getDesktopAndChildren(folder.desktopId);

    this.updateState(state => ({
      ...state,
      desktops: state.desktops
        .filter(d => !desktopIdsToDelete.includes(d.id))
        .map(d =>
          d.id === state.currentDesktopId
            ? { ...d, folders: d.folders.filter(f => f.id !== folderId) }
            : d
        )
    }));
  }

  private getDesktopAndChildren(desktopId: string): string[] {
    const ids = [desktopId];
    const state = this.state();

    const addChildren = (parentId: string) => {
      state.desktops
        .filter(d => d.parentId === parentId)
        .forEach(d => {
          ids.push(d.id);
          addChildren(d.id);
        });
    };

    addChildren(desktopId);
    return ids;
  }

  openFolder(folderId: string): void {
    const folder = this.currentDesktop()?.folders.find(f => f.id === folderId);
    if (folder) {
      this.navigateToDesktop(folder.desktopId);
    }
  }

  // ==================== CONEXIONES ====================

  addConnection(fromNoteId: string, toNoteId: string): Connection {
    const id = this.generateId();
    const connection: Connection = {
      id,
      fromNoteId,
      toNoteId,
      color: this.theme().primaryColor
    };

    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? { ...d, connections: [...d.connections, connection] }
          : d
      )
    }));

    return connection;
  }

  deleteConnection(connectionId: string): void {
    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === state.currentDesktopId
          ? { ...d, connections: d.connections.filter(c => c.id !== connectionId) }
          : d
      )
    }));
  }

  // ==================== TEMA ====================

  updateTheme(updates: Partial<ThemeConfig>): void {
    this.updateState(state => ({
      ...state,
      theme: { ...state.theme, ...updates }
    }));
  }

  // ==================== EXPORTAR / IMPORTAR ====================

  exportData(): string {
    return JSON.stringify(this.state(), null, 2);
  }

  downloadData(): void {
    const data = this.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multidesktop_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importData(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString) as AppState;
      // Validación básica
      if (!data.desktops || !Array.isArray(data.desktops)) {
        throw new Error('Invalid data format');
      }

      this.state.set(data);
      this.saveState();
      return true;
    } catch (e) {
      console.error('Error importing data:', e);
      return false;
    }
  }

  clearAllData(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.state.set(this.loadState());
  }

  /**
   * Reload state from localStorage (used after sync operations)
   */
  reloadFromStorage(): void {
    this.state.set(this.loadState());
  }

  // ==================== UTILIDADES ====================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  renameDesktop(desktopId: string, newName: string): void {
    this.updateState(state => ({
      ...state,
      desktops: state.desktops.map(d =>
        d.id === desktopId ? { ...d, name: newName } : d
      )
    }));
  }

  // Obtener estadísticas del desktop
  getDesktopStats(desktopId: string): { notes: number, folders: number, images: number } {
    const desktop = this.state().desktops.find(d => d.id === desktopId);
    if (!desktop) return { notes: 0, folders: 0, images: 0 };

    const images = desktop.notes.reduce((sum, n) => sum + n.images.length, 0);
    return {
      notes: desktop.notes.length,
      folders: desktop.folders.length,
      images
    };
  }
}
