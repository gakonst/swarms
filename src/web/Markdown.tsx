import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'

type Extensions = { fromMarkdownExtensions?: unknown[]; micromarkExtensions?: unknown[] }

function readGfm(this: { data(): object }) {
  const data: Extensions = this.data()
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), gfm()]
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), gfmFromMarkdown()]
}

const plugins = [readGfm]

function resolve(base: string | undefined) {
  return (url: string) => {
    if (!base || /^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url)) return defaultUrlTransform(url)
    try {
      return new URL(url, base).href
    } catch {
      return defaultUrlTransform(url)
    }
  }
}

export function Markdown(props: { base?: string; streaming?: boolean; text: string }) {
  return (
    <div className="markdown" data-streaming={props.streaming === true}>
      <ReactMarkdown
        urlTransform={resolve(props.base)}
        components={{
          a: (link) => (
            <a href={link.href} rel="noreferrer" target="_blank">
              {link.children}
            </a>
          ),
          table: (table) => (
            <div className="markdown-table">
              <table>{table.children}</table>
            </div>
          ),
        }}
        remarkPlugins={plugins}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  )
}
