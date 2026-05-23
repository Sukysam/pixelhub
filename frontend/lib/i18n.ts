import { useCallback, useEffect, useMemo, useState } from "react";

export type Lang = "en" | "es" | "fr";

const MESSAGES: Record<Lang, Record<string, string>> = {
  en: {
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
    deleteSelected: "Delete Selected",
    confirm: "Confirm",
    confirmSaveTitle: "Confirm changes",
    confirmSaveBody: "Are you sure you want to save these changes?",
    confirmDeleteTitle: "Confirm deletion",
    confirmDeleteBody: "This will remove the record from active lists (soft delete). Continue?",
    conflict: "This record was modified by another user. Refresh and try again.",
    forbidden: "You do not have permission to perform this action.",
    nameRequired: "Name is required.",
    amountPaidInvalid: "Amount paid must be a valid number > 0.",
    unitPriceInvalid: "Unit price must be a valid number >= 0.",
    stockQuantityInvalid: "Stock quantity must be an integer >= 0.",
    saved: "Changes saved.",
    deleted: "Deleted.",
    loadMore: "Load more",
    login: "Login",
    logout: "Logout",
  },
  es: {
    save: "Guardar",
    cancel: "Cancelar",
    edit: "Editar",
    delete: "Eliminar",
    deleteSelected: "Eliminar seleccionados",
    confirm: "Confirmar",
    confirmSaveTitle: "Confirmar cambios",
    confirmSaveBody: "¿Seguro que deseas guardar estos cambios?",
    confirmDeleteTitle: "Confirmar eliminación",
    confirmDeleteBody: "Esto quitará el registro de las listas activas (eliminación suave). ¿Continuar?",
    conflict: "Este registro fue modificado por otro usuario. Actualiza e inténtalo de nuevo.",
    forbidden: "No tienes permisos para realizar esta acción.",
    nameRequired: "El nombre es obligatorio.",
    amountPaidInvalid: "El importe pagado debe ser un número válido > 0.",
    unitPriceInvalid: "El precio unitario debe ser un número válido >= 0.",
    stockQuantityInvalid: "La cantidad debe ser un entero >= 0.",
    saved: "Cambios guardados.",
    deleted: "Eliminado.",
    loadMore: "Cargar más",
    login: "Iniciar sesión",
    logout: "Cerrar sesión",
  },
  fr: {
    save: "Enregistrer",
    cancel: "Annuler",
    edit: "Modifier",
    delete: "Supprimer",
    deleteSelected: "Supprimer la sélection",
    confirm: "Confirmer",
    confirmSaveTitle: "Confirmer les modifications",
    confirmSaveBody: "Confirmer l’enregistrement de ces modifications ?",
    confirmDeleteTitle: "Confirmer la suppression",
    confirmDeleteBody: "Ceci retirera l’élément des listes actives (suppression logique). Continuer ?",
    conflict: "Cet enregistrement a été modifié par un autre utilisateur. Actualisez et réessayez.",
    forbidden: "Vous n’avez pas la permission d’effectuer cette action.",
    nameRequired: "Le nom est requis.",
    amountPaidInvalid: "Le montant payé doit être un nombre valide > 0.",
    unitPriceInvalid: "Le prix unitaire doit être un nombre valide >= 0.",
    stockQuantityInvalid: "Le stock doit être un entier >= 0.",
    saved: "Modifications enregistrées.",
    deleted: "Supprimé.",
    loadMore: "Charger plus",
    login: "Connexion",
    logout: "Déconnexion",
  },
};

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  const raw = window.localStorage.getItem("lang");
  if (raw === "es" || raw === "fr" || raw === "en") return raw;
  return "en";
}

export function setLang(lang: Lang) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("lang", lang);
}

export function useI18n() {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const setLangAndPersist = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const dict = useMemo(() => MESSAGES[lang], [lang]);
  const t = useCallback((key: string) => dict[key] ?? MESSAGES.en[key] ?? key, [dict]);

  return { lang, setLang: setLangAndPersist, t };
}
