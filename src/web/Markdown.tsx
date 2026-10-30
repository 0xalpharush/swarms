import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

export function Markdown(props: { streaming?: boolean; text: string }) {
  return (
    <div className="markdown" data-streaming={props.streaming === true}>
      <ReactMarkdown
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
