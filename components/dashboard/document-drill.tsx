"use client";

import { useState, type ReactNode } from "react";

import {
  DrillBack,
  DrillDialog,
  DrillView,
  setDrillParams,
  useDrillParams,
  useOpenDrill,
  useReturnFocus,
} from "./drill-dialog";

/**
 * A two-level drill-down built from the shared drill pieces: a bar opens a list of documents (an
 * order, a receipt), a row opens that document's lines, and Back returns. Both levels live in URL
 * parameters (`param` and `docParam`), so a reload or a shared link reopens them, and each loads on
 * demand from its route. The page supplies the URLs and renders each level's data.
 */

/** The open drill-down's two parameters, and the way to open one from a bar. */
export function useDocumentDrill(param: string, docParam: string) {
  const values = useDrillParams([param, docParam]);
  const open = useOpenDrill(param, [docParam]);
  return { value: values[param], doc: values[docParam], open };
}

export function DocumentDrill<Documents, Lines>({
  param,
  docParam,
  testId,
  title,
  description,
  documentsUrl,
  linesUrl,
  renderDocuments,
  renderLines,
  documentsWhat = "documents",
  linesWhat = "lines",
  backLabel = "Back to documents",
}: {
  /** The bar's URL parameter, such as `drill`. */
  param: string;
  /** The open document's URL parameter, such as `doc`. */
  docParam: string;
  testId: string;
  /** The dialog title for a bar's value; `null` when the value is malformed or outside the filters. */
  title: (value: string) => string | null;
  description: ReactNode;
  documentsUrl: (value: string) => string;
  linesUrl: (value: string, doc: string) => string;
  /** The list; `open(doc, heading)` opens a document, `heading` titling its lines. */
  renderDocuments: (data: Documents, open: (doc: string, heading: string) => void) => ReactNode;
  renderLines: (data: Lines) => ReactNode;
  documentsWhat?: string;
  linesWhat?: string;
  backLabel?: string;
}) {
  const { value, doc } = useDocumentDrill(param, docParam);
  // The last bar stays on screen while the dialog fades out, and is where focus goes back to.
  const [lastValue, setLastValue] = useState(value);
  if (value !== null && value !== lastValue) setLastValue(value);
  const shown = value ?? lastValue;
  const heading = shown ? title(shown) : null;
  const [headings, setHeadings] = useState<Map<string, string>>(new Map());
  const { container, setReturnTo } = useReturnFocus(doc);

  return (
    <DrillDialog
      open={value !== null && heading !== null}
      params={[param, docParam]}
      testId={testId}
      title={heading ?? ""}
      description={description}
      // After a reload, focus goes back to the bar for this value.
      returnSelector={() => (shown ? `[data-drill="${CSS.escape(shown)}"]` : null)}
    >
      {shown && heading !== null && (
        <>
          <div ref={container} hidden={doc !== null}>
            <DrillView<Documents> key={documentsUrl(shown)} url={documentsUrl(shown)} what={documentsWhat}>
              {(data) =>
                renderDocuments(data, (opened, label) => {
                  setHeadings((current) => new Map(current).set(opened, label));
                  setDrillParams({ [docParam]: opened });
                })
              }
            </DrillView>
          </div>
          {doc && (
            <div className="flex flex-col gap-3" data-testid="drill-lines">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <DrillBack
                  label={backLabel}
                  onClick={() => {
                    setReturnTo(doc);
                    setDrillParams({ [docParam]: null });
                  }}
                />
                <h3 className="font-medium" data-testid="drill-document-title">
                  {headings.get(doc) ?? doc.replaceAll("~", " · ")}
                </h3>
              </div>
              <DrillView<Lines> key={linesUrl(shown, doc)} url={linesUrl(shown, doc)} what={linesWhat}>
                {renderLines}
              </DrillView>
            </div>
          )}
        </>
      )}
    </DrillDialog>
  );
}
