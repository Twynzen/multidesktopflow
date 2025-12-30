import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  HostListener,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Note, NoteImage, Position, Size } from '../../models/desktop.model';

@Component({
  selector: 'app-note',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './note.component.html',
  styleUrl: './note.component.scss'
})
export class NoteComponent {
  @Input() note!: Note;
  @Output() noteChange = new EventEmitter<Partial<Note>>();
  @Output() noteDelete = new EventEmitter<void>();
  @Output() noteFocus = new EventEmitter<void>();
  @Output() connectionStart = new EventEmitter<string>();

  @ViewChild('contentArea') contentArea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  isDragging = signal(false);
  isResizing = signal(false);
  isEditing = signal(false);
  editingTitle = signal(false);
  showImageMenu = signal<string | null>(null);

  private dragOffset = { x: 0, y: 0 };
  private initialSize = { width: 0, height: 0 };
  private initialPos = { x: 0, y: 0 };
  private resizeHandle = '';

  // Tamaños mínimos y máximos
  readonly MIN_WIDTH = 200;
  readonly MIN_HEIGHT = 150;
  readonly MAX_WIDTH = 800;
  readonly MAX_HEIGHT = 1200;

  get noteStyle() {
    return {
      left: `${this.note.position.x}px`,
      top: `${this.note.position.y}px`,
      width: `${this.note.size.width}px`,
      height: this.note.minimized ? 'auto' : `${this.note.size.height}px`,
      zIndex: this.note.zIndex
    };
  }

  // ==================== DRAG ====================
  onDragStart(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('resize-handle')) return;
    if (this.isEditing() || this.editingTitle()) return;

    event.preventDefault();
    this.isDragging.set(true);
    this.noteFocus.emit();

    this.dragOffset = {
      x: event.clientX - this.note.position.x,
      y: event.clientY - this.note.position.y
    };

    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  private onDragMove = (event: MouseEvent): void => {
    if (!this.isDragging()) return;

    const newX = Math.max(0, event.clientX - this.dragOffset.x);
    const newY = Math.max(0, event.clientY - this.dragOffset.y);

    this.noteChange.emit({
      position: { x: newX, y: newY }
    });
  };

  private onDragEnd = (): void => {
    this.isDragging.set(false);
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
  };

  // ==================== RESIZE ====================
  onResizeStart(event: MouseEvent, handle: string): void {
    event.preventDefault();
    event.stopPropagation();

    this.isResizing.set(true);
    this.resizeHandle = handle;
    this.noteFocus.emit();

    this.initialSize = { ...this.note.size };
    this.initialPos = { x: event.clientX, y: event.clientY };

    document.addEventListener('mousemove', this.onResizeMove);
    document.addEventListener('mouseup', this.onResizeEnd);
  }

  private onResizeMove = (event: MouseEvent): void => {
    if (!this.isResizing()) return;

    const deltaX = event.clientX - this.initialPos.x;
    const deltaY = event.clientY - this.initialPos.y;

    let newWidth = this.initialSize.width;
    let newHeight = this.initialSize.height;
    let newX = this.note.position.x;
    let newY = this.note.position.y;

    if (this.resizeHandle.includes('e')) {
      newWidth = Math.min(this.MAX_WIDTH, Math.max(this.MIN_WIDTH, this.initialSize.width + deltaX));
    }
    if (this.resizeHandle.includes('w')) {
      const potentialWidth = this.initialSize.width - deltaX;
      if (potentialWidth >= this.MIN_WIDTH && potentialWidth <= this.MAX_WIDTH) {
        newWidth = potentialWidth;
        newX = this.note.position.x + deltaX;
      }
    }
    if (this.resizeHandle.includes('s')) {
      newHeight = Math.min(this.MAX_HEIGHT, Math.max(this.MIN_HEIGHT, this.initialSize.height + deltaY));
    }
    if (this.resizeHandle.includes('n')) {
      const potentialHeight = this.initialSize.height - deltaY;
      if (potentialHeight >= this.MIN_HEIGHT && potentialHeight <= this.MAX_HEIGHT) {
        newHeight = potentialHeight;
        newY = this.note.position.y + deltaY;
      }
    }

    this.noteChange.emit({
      size: { width: newWidth, height: newHeight },
      position: { x: newX, y: newY }
    });
  };

  private onResizeEnd = (): void => {
    this.isResizing.set(false);
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
  };

  // ==================== CONTENIDO ====================
  onTitleClick(): void {
    this.editingTitle.set(true);
    this.noteFocus.emit();
  }

  onTitleBlur(event: FocusEvent): void {
    const value = (event.target as HTMLInputElement).value;
    this.editingTitle.set(false);
    this.noteChange.emit({ title: value || 'Sin título' });
  }

  onTitleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    }
  }

  onContentFocus(): void {
    this.isEditing.set(true);
    this.noteFocus.emit();
  }

  onContentBlur(): void {
    this.isEditing.set(false);
  }

  onContentChange(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.noteChange.emit({ content: value });
  }

  // ==================== IMÁGENES ====================
  onAddImage(): void {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    const base64 = await this.fileToBase64(file);
    const dimensions = await this.getImageDimensions(base64);

    const newImage: NoteImage = {
      id: `img-${Date.now()}`,
      data: base64,
      originalName: file.name,
      size: {
        width: Math.min(dimensions.width, this.note.size.width - 20),
        height: Math.min(dimensions.height, 300)
      },
      position: { x: 10, y: 10 }
    };

    this.noteChange.emit({
      images: [...this.note.images, newImage]
    });

    input.value = '';
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          this.processImageFile(file);
        }
        break;
      }
    }
  }

  private async processImageFile(file: File): Promise<void> {
    const base64 = await this.fileToBase64(file);
    const dimensions = await this.getImageDimensions(base64);

    const newImage: NoteImage = {
      id: `img-${Date.now()}`,
      data: base64,
      originalName: file.name,
      size: {
        width: Math.min(dimensions.width, this.note.size.width - 20),
        height: Math.min(dimensions.height, 300)
      },
      position: { x: 10, y: 10 }
    };

    this.noteChange.emit({
      images: [...this.note.images, newImage]
    });
  }

  onImageResize(imageId: string, newSize: Size): void {
    const images = this.note.images.map(img =>
      img.id === imageId ? { ...img, size: newSize } : img
    );
    this.noteChange.emit({ images });
  }

  onDeleteImage(imageId: string): void {
    const images = this.note.images.filter(img => img.id !== imageId);
    this.noteChange.emit({ images });
    this.showImageMenu.set(null);
  }

  onCopyImage(image: NoteImage): void {
    // Copiar imagen al clipboard
    fetch(image.data)
      .then(res => res.blob())
      .then(blob => {
        navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
      });
    this.showImageMenu.set(null);
  }

  toggleImageMenu(imageId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.showImageMenu.set(this.showImageMenu() === imageId ? null : imageId);
  }

  // ==================== ACCIONES ====================
  toggleMinimize(): void {
    this.noteChange.emit({ minimized: !this.note.minimized });
  }

  onDelete(): void {
    this.noteDelete.emit();
  }

  onStartConnection(): void {
    this.connectionStart.emit(this.note.id);
  }

  // ==================== DROP DE IMÁGENES ====================
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (!files?.length) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await this.processImageFile(file);
      }
    }
  }

  // ==================== UTILIDADES ====================
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private getImageDimensions(base64: string): Promise<{ width: number, height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = base64;
    });
  }

  // Click fuera para cerrar menús
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.showImageMenu()) {
      this.showImageMenu.set(null);
    }
  }
}
