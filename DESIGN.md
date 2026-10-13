---
version: alpha
colors:
  primary: '#1677ff'
  canvas: '#ffffff'
  surface: '#f7f9fc'
  text: '#152238'
  muted: '#64748b'
  border: '#e4eaf2'
  danger: '#cf354f'
typography:
  sans:
    fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '13px'
    lineHeight: '1.5'
  map:
    fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '16px'
    lineHeight: '1.45'
rounded:
  small: '6px'
  topic: '12px'
spacing:
  unit: '4px'
components:
  toolbar:
    height: '74px'
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.text}'
  header:
    height: '54px'
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
  sidebar:
    width: '260px'
  inspector:
    width: '310px'
    backgroundColor: '{colors.canvas}'
  divider:
    backgroundColor: '{colors.border}'
  dangerButton:
    backgroundColor: '{colors.danger}'
---

## Overview

Chinese desktop mind-map editor for planning and knowledge work. Full-screen primary concept is design/concept.png. White dotted canvas, quiet cool blue app chrome, colored branching lines are the signature. Preserve familiar editor anatomy, not a marketing page.

## Colors

Runtime canonical tokens live in src/styles.css and match the named values above. Theme palettes color map branches, not unrelated controls. Dark mode preserves document hierarchy.

## Typography

Header and buttons 13px, outline 13px, inspector labels 12px, nodes 16px, root 24px. Native Chinese-capable system fonts; no network fonts or late swaps.

## Layout

Header, toolbar, workbook/outlines rail, centered interactive canvas, inspector, bottom status. Native concept is 1536x1024. Below 1100px hide the outline rail by default; below 760px inspector becomes a toggleable drawer and toolbar scrolls, keeping canvas operable.

## Elevation & Depth

No giant nested cards. Flat dividers in chrome. Only floating menus and modals receive restrained shadows.

## Shapes

Small controls have 6px corners. Primary topics use 12px corners; leaf topics use text and colored underlines. Tree edges are curved SVG paths.

## Components

Canonical primitives: IconButton, Modal, PopupMenu, Field, Toast. All app copy is Chinese and code-native. Inspector uses native select when OS popup behavior is acceptable. Image attachments belong to user documents; the concept contains no image asset embedded as actual UI.

## Do's and Don'ts

No subscription panels or copied Xmind logo/artwork. Keep every visible action functional. Reversible node edits use undo; importing invalid data retains current work. Escape restores focus from modal. Search has clear button and respects IME. Always expose keyboard alternatives to dragging.
