import { liveProductConfigs } from '../_shared/live-products'
import { createFulfillmentTemplate } from '../_shared/product-template'

const template = createFulfillmentTemplate(liveProductConfigs['floriva-web'])

export default template.Component
export const renderEmail = template.renderEmail
