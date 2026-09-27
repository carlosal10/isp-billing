import React, { useId } from "react";

export function Field({ label, hint, error, children, className = "" }) {
  const generatedId = useId();
  const control = React.Children.only(children);
  const id = control.props.id || generatedId;
  const description = error || hint;
  return (
    <div className={`ui-field ${className}`.trim()}>
      <label htmlFor={id}>{label}{control.props.required ? <span aria-hidden="true"> *</span> : null}</label>
      {React.cloneElement(control, {
        id,
        "aria-invalid": error ? true : control.props["aria-invalid"],
        "aria-describedby": [control.props["aria-describedby"], description && `${id}-help`].filter(Boolean).join(" ") || undefined,
      })}
      {description ? <small id={`${id}-help`} className={error ? "ui-field-error" : "ui-field-hint"}>{description}</small> : null}
    </div>
  );
}
