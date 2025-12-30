import {
  Component,
  HostListener,
  ViewChild,
  ElementRef,
  signal,
  computed,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../services/storage.service';
import { ThemeService } from '../../services/theme.service';
import { NoteComponent } from '../note/note.component';
import { FolderComponent } from '../folder/folder.component';
import { ConnectionsComponent } from '../connections/connections.component';
import { ToolbarComponent } from '../toolbar/toolbar.component';
import { Note, Folder, Desktop } from '../../models/desktop.model';

interface Particle {
  id: number;
  x: number;
  y: number;
  active: boolean;
}

@Component({
  selector: 'app-desktop',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NoteComponent,
    FolderComponent,
    ConnectionsComponent,
    ToolbarComponent
  ],
  templateUrl: './desktop.component.html',
  styleUrl: './desktop.component.scss'
})
export class DesktopComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('desktopArea') desktopArea!: ElementRef<HTMLDivElement>;

  // Estado
  isConnecting = signal(false);
  connectingFromId = signal<string | null>(null);
  mousePosition = signal({ x: 0, y: 0 });
  showStructure = signal(false);
  isTransitioning = signal(false);
  transitionDirection = signal<'in' | 'out'>('in');

  // Partículas para efecto visual
  particles = signal<Particle[]>([]);
  private particleId = 0;

  // Computed
  readonly currentDesktop = computed(() => this.storage.currentDesktop());
  readonly breadcrumb = computed(() => this.storage.breadcrumbPath());
  readonly notes = computed(() => this.currentDesktop()?.notes || []);
  readonly folders = computed(() => this.currentDesktop()?.folders || []);
  readonly connections = computed(() => this.currentDesktop()?.connections || []);
  readonly allDesktops = computed(() => this.storage.desktops());

  constructor(
    public storage: StorageService,
    public themeService: ThemeService
  ) {
    // Generar partículas aleatorias
    if (this.themeService.particlesEnabled()) {
      this.startParticleEffect();
    }
  }

  // ==================== NOTAS ====================
  onAddNote(): void {
    const area = this.desktopArea?.nativeElement;
    const x = area ? Math.random() * (area.clientWidth - 350) + 50 : 100;
    const y = area ? Math.random() * (area.clientHeight - 250) + 80 : 100;
    this.storage.addNote({ x, y });
  }

  onNoteChange(noteId: string, updates: Partial<Note>): void {
    this.storage.updateNote(noteId, updates);
  }

  onNoteDelete(noteId: string): void {
    this.storage.deleteNote(noteId);
  }

  onNoteFocus(noteId: string): void {
    this.storage.bringNoteToFront(noteId);
  }

  // ==================== CARPETAS ====================
  onAddFolder(): void {
    const area = this.desktopArea?.nativeElement;
    const x = area ? Math.random() * (area.clientWidth - 150) + 50 : 100;
    const y = area ? Math.random() * (area.clientHeight - 150) + 80 : 100;
    this.storage.addFolder('Nueva Carpeta', { x, y });
  }

  onFolderChange(folderId: string, updates: Partial<Folder>): void {
    this.storage.updateFolder(folderId, updates);
  }

  onFolderDelete(folderId: string): void {
    if (confirm('¿Eliminar esta carpeta y todo su contenido?')) {
      this.storage.deleteFolder(folderId);
    }
  }

  onFolderOpen(folderId: string): void {
    // Transición 3D
    this.transitionDirection.set('out');
    this.isTransitioning.set(true);

    setTimeout(() => {
      this.storage.openFolder(folderId);
      this.transitionDirection.set('in');

      setTimeout(() => {
        this.isTransitioning.set(false);
      }, 300);
    }, 300);
  }

  getFolderStats(folderId: string): { notes: number, folders: number, images: number } {
    const folder = this.folders().find(f => f.id === folderId);
    if (!folder) return { notes: 0, folders: 0, images: 0 };
    return this.storage.getDesktopStats(folder.desktopId);
  }

  // ==================== NAVEGACIÓN ====================
  onNavigateTo(desktopId: string): void {
    if (desktopId === this.currentDesktop()?.id) return;

    this.transitionDirection.set('out');
    this.isTransitioning.set(true);

    setTimeout(() => {
      this.storage.navigateToDesktop(desktopId);
      this.transitionDirection.set('in');

      setTimeout(() => {
        this.isTransitioning.set(false);
      }, 300);
    }, 300);
  }

  // ==================== CONEXIONES ====================
  onStartConnection(noteId: string): void {
    this.isConnecting.set(true);
    this.connectingFromId.set(noteId);
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.isConnecting()) {
      this.mousePosition.set({ x: event.clientX, y: event.clientY });
    }
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (this.isConnecting()) {
      // Verificar si se hizo click en una nota
      const target = event.target as HTMLElement;
      const noteElement = target.closest('.note');

      if (noteElement) {
        const noteId = this.findNoteIdFromElement(noteElement, event);
        if (noteId && noteId !== this.connectingFromId()) {
          this.storage.addConnection(this.connectingFromId()!, noteId);
        }
      }

      this.isConnecting.set(false);
      this.connectingFromId.set(null);
    }
  }

  private findNoteIdFromElement(element: Element, event: MouseEvent): string | null {
    // Buscar la nota más cercana al click
    const notes = this.notes();
    for (const note of notes) {
      const noteEl = document.querySelector(`[data-note-id="${note.id}"]`);
      if (noteEl?.contains(element)) {
        return note.id;
      }
    }

    // Fallback: buscar por posición
    const x = event.clientX;
    const y = event.clientY;

    for (const note of notes) {
      if (
        x >= note.position.x &&
        x <= note.position.x + note.size.width &&
        y >= note.position.y &&
        y <= note.position.y + note.size.height
      ) {
        return note.id;
      }
    }

    return null;
  }

  onDeleteConnection(connectionId: string): void {
    this.storage.deleteConnection(connectionId);
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    if (this.isConnecting()) {
      this.isConnecting.set(false);
      this.connectingFromId.set(null);
    }
  }

  // ==================== EXPORTAR / IMPORTAR ====================
  onExportData(): void {
    this.storage.downloadData();
  }

  onImportData(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (this.storage.importData(content)) {
        alert('Datos importados correctamente');
      } else {
        alert('Error al importar datos');
      }
    };

    reader.readAsText(file);
    input.value = '';
  }

  // ==================== ESTRUCTURA ====================
  onToggleStructure(): void {
    this.showStructure.update(v => !v);
  }

  getDesktopChildren(parentId: string | null): Desktop[] {
    return this.allDesktops().filter(d => d.parentId === parentId);
  }

  // ==================== EFECTOS VISUALES ====================
  private startParticleEffect(): void {
    setInterval(() => {
      if (!this.themeService.particlesEnabled()) return;

      const x = Math.random() * window.innerWidth;
      const y = Math.random() * window.innerHeight;

      this.addParticle(x, y);
    }, 2000);
  }

  private addParticle(x: number, y: number): void {
    const particle: Particle = {
      id: this.particleId++,
      x,
      y,
      active: true
    };

    this.particles.update(p => [...p, particle]);

    // Eliminar después de la animación
    setTimeout(() => {
      this.particles.update(p => p.filter(part => part.id !== particle.id));
    }, 2000);
  }

  // ==================== CONTEXT MENU (CLICK DERECHO) ====================
  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    // Solo en el área del escritorio, no en notas/carpetas
    const target = event.target as HTMLElement;
    if (target.classList.contains('desktop-area')) {
      event.preventDefault();
      // Podemos agregar un menú contextual aquí en el futuro
    }
  }

  // ==================== TRACK BY FUNCTIONS ====================
  trackByNote(index: number, note: Note): string {
    return note.id;
  }

  trackByFolder(index: number, folder: Folder): string {
    return folder.id;
  }

  trackByParticle(index: number, particle: Particle): number {
    return particle.id;
  }
}
