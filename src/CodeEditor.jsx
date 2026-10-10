import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
async function language(file) {
  const ext = file.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext))
    return (await import('@codemirror/lang-javascript')).javascript({
      jsx: ['jsx', 'tsx'].includes(ext),
      typescript: ['ts', 'tsx'].includes(ext),
    });
  if (ext === 'json') return (await import('@codemirror/lang-json')).json();
  if (['html', 'htm'].includes(ext)) return (await import('@codemirror/lang-html')).html();
  if (ext === 'css') return (await import('@codemirror/lang-css')).css();
  if (['md', 'markdown'].includes(ext))
    return (await import('@codemirror/lang-markdown')).markdown();
  if (ext === 'py') return (await import('@codemirror/lang-python')).python();
  return [];
}
export default function CodeEditor({ file, content, readonly, onChange, onSave }) {
  const parent = useRef(null),
    editor = useRef(null),
    callbacks = useRef({ onChange, onSave }),
    readonlyExtension = useRef(new Compartment());
  callbacks.current = { onChange, onSave };
  useEffect(() => {
    const syntax = new Compartment();
    let disposed = false;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: content.replaceAll('\r\n', '\n'),
        extensions: [
          basicSetup,
          syntax.of([]),
          oneDark,
          readonlyExtension.current.of([
            EditorState.readOnly.of(readonly),
            EditorView.editable.of(!readonly),
          ]),
          EditorView.contentAttributes.of({
            'aria-label': `Éditeur ${file}`,
            'aria-multiline': 'true',
          }),
          Prec.high(
            EditorView.theme({
              '&': { height: '100%', backgroundColor: '#141c17', color: '#d9e5db' },
              '.cm-scroller': {
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                lineHeight: '1.9',
              },
              '.cm-gutters': {
                backgroundColor: '#141b16',
                borderRight: '1px solid #2b382e',
                color: '#809284',
              },
              '.cm-activeLine': { backgroundColor: '#202c23' },
              '.cm-activeLineGutter': { backgroundColor: '#202c23' },
              '&.cm-focused': { outline: 'none' },
            })
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                callbacks.current.onSave();
                return true;
              }
            },
          }),
        ],
      }),
    });
    editor.current = view;
    language(file)
      .then((extension) => {
        if (!disposed) view.dispatch({ effects: syntax.reconfigure(extension) });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      view.destroy();
      editor.current = null;
    };
  }, [file]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: readonlyExtension.current.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    });
  }, [readonly]);
  useEffect(() => {
    const view = editor.current,
      next = content.replaceAll('\r\n', '\n');
    if (view && view.state.doc.toString() !== next)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  }, [content]);
  return <div className="code-editor" ref={parent} />;
}
