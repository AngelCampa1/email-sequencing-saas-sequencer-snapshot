import { liveProductConfigs } from '../_shared/live-products'
import { createNurtureTemplate } from '../_shared/product-template'

const template = createNurtureTemplate(liveProductConfigs['floriva-web'])

export default template.Component
export const renderEmail = template.renderEmail
