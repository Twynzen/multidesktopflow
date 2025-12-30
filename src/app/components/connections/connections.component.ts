import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Connection, Note } from '../../models/desktop.model';

interface Point {
  x: number;
  y: number;
}

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg #svgCanvas class="connections-canvas">
      <!-- Conexiones existentes -->
      <g *ngFor="let conn of connections">
        <path
          [attr.d]="getConnectionPath(conn)"
          [attr.stroke]="conn.color || 'var(--primary-color)'"
          stroke-width="2"
          fill="none"
          class="connection-line"
          (click)="onConnectionClick(conn, $event)"
        />
        <!-- Punto de borrado -->
        <circle
          *ngIf="hoveredConnection === conn.id"
          [attr.cx]="getConnectionMidpoint(conn).x"
          [attr.cy]="getConnectionMidpoint(conn).y"
          r="8"
          fill="var(--danger)"
          class="delete-point"
          (click)="deleteConnection.emit(conn.id); $event.stopPropagation()"
        />
      </g>

      <!-- Línea temporal mientras se dibuja -->
      <path
        *ngIf="isDrawing && tempLine"
        [attr.d]="tempLine"
        stroke="var(--primary-color)"
        stroke-width="2"
        stroke-dasharray="5,5"
        fill="none"
        class="temp-line"
      />
    </svg>
  `,
  styles: [`
    .connections-canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 50;
    }

    .connection-line {
      pointer-events: stroke;
      cursor: pointer;
      transition: stroke-width 0.2s ease;

      &:hover {
        stroke-width: 3;
        filter: drop-shadow(0 0 5px rgba(var(--primary-rgb), 0.5));
      }
    }

    .delete-point {
      pointer-events: all;
      cursor: pointer;
      opacity: 0.8;
      transition: all 0.2s ease;

      &:hover {
        r: 10;
        opacity: 1;
      }
    }

    .temp-line {
      opacity: 0.7;
      animation: dash 0.5s linear infinite;
    }

    @keyframes dash {
      to {
        stroke-dashoffset: -10;
      }
    }
  `]
})
export class ConnectionsComponent implements OnChanges {
  @Input() connections: Connection[] = [];
  @Input() notes: Note[] = [];
  @Input() isDrawing = false;
  @Input() drawingFromId: string | null = null;
  @Input() mousePosition: Point = { x: 0, y: 0 };
  @Output() deleteConnection = new EventEmitter<string>();

  @ViewChild('svgCanvas') svgCanvas!: ElementRef<SVGElement>;

  hoveredConnection: string | null = null;
  tempLine: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mousePosition'] || changes['drawingFromId']) {
      this.updateTempLine();
    }
  }

  private updateTempLine(): void {
    if (!this.isDrawing || !this.drawingFromId) {
      this.tempLine = null;
      return;
    }

    const fromNote = this.notes.find(n => n.id === this.drawingFromId);
    if (!fromNote) {
      this.tempLine = null;
      return;
    }

    const from = this.getNoteCenter(fromNote);
    const to = this.mousePosition;
    this.tempLine = this.createCurvePath(from, to);
  }

  getConnectionPath(conn: Connection): string {
    const fromNote = this.notes.find(n => n.id === conn.fromNoteId);
    const toNote = this.notes.find(n => n.id === conn.toNoteId);

    if (!fromNote || !toNote) return '';

    const from = this.getNoteCenter(fromNote);
    const to = this.getNoteCenter(toNote);

    return this.createCurvePath(from, to);
  }

  getConnectionMidpoint(conn: Connection): Point {
    const fromNote = this.notes.find(n => n.id === conn.fromNoteId);
    const toNote = this.notes.find(n => n.id === conn.toNoteId);

    if (!fromNote || !toNote) return { x: 0, y: 0 };

    const from = this.getNoteCenter(fromNote);
    const to = this.getNoteCenter(toNote);

    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2
    };
  }

  private getNoteCenter(note: Note): Point {
    return {
      x: note.position.x + note.size.width / 2,
      y: note.position.y + note.size.height / 2
    };
  }

  private createCurvePath(from: Point, to: Point): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Control points para la curva Bezier
    const curvature = Math.min(distance * 0.3, 100);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - curvature;

    return `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
  }

  onConnectionClick(conn: Connection, event: MouseEvent): void {
    event.stopPropagation();
    this.hoveredConnection = this.hoveredConnection === conn.id ? null : conn.id;
  }
}
